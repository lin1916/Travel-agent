import { createHash } from 'node:crypto';
import {
  AcceptProposalInputSchema,
  AcceptProposalPlaceInputSchema,
  PlanProposalDraftSchema,
  type AcceptProposalInput,
  type AcceptProposalPlaceInput,
  type CandidatePlace,
  type Conversation,
  type PlanProposal,
  type PlanProposalDraft,
  type PlanVersion,
  type PlanningContext,
  type ProposalAcceptanceResult,
} from '@travel/contracts';
import { CandidateService } from '../candidates/candidate-service.js';
import { ApplicationError } from '../errors.js';
import type { ConversationOwnershipPort } from '../planning-context/planning-context-service.js';
import { PlanService, type PlanContext } from '../plans/plan-service.js';

export interface StoredPlanProposal extends PlanProposal {
  acceptedPlaceIds: string[];
  idempotency: Record<string, { request: string; result: ProposalAcceptanceResult }>;
}

export interface PlanProposalRepository {
  create(proposal: StoredPlanProposal): Promise<void>;
  get(id: string): Promise<StoredPlanProposal | undefined>;
  list(conversationId: string): Promise<StoredPlanProposal[]>;
  save(proposal: StoredPlanProposal, expectedVersion: number): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  snapshot?(): unknown;
  restore?(snapshot: unknown): void;
  loadIdempotency?(proposalId: string): Promise<Record<string, { request: string; result: ProposalAcceptanceResult }>>;
}

export class InMemoryPlanProposalRepository implements PlanProposalRepository {
  private readonly proposals = new Map<string, StoredPlanProposal>();

  async create(proposal: StoredPlanProposal): Promise<void> {
    if (this.proposals.has(proposal.id)) throw new ApplicationError('conflict', 'plan proposal already exists');
    this.proposals.set(proposal.id, structuredClone(proposal));
  }

  async get(id: string): Promise<StoredPlanProposal | undefined> {
    const proposal = this.proposals.get(id);
    return proposal ? structuredClone(proposal) : undefined;
  }

  async list(conversationId: string): Promise<StoredPlanProposal[]> {
    return [...this.proposals.values()]
      .filter(proposal => proposal.conversationId === conversationId)
      .map(proposal => structuredClone(proposal));
  }

  async save(proposal: StoredPlanProposal, expectedVersion: number): Promise<void> {
    const current = this.proposals.get(proposal.id);
    if (!current || current.version !== expectedVersion) throw new ApplicationError('conflict', 'plan proposal version changed');
    this.proposals.set(proposal.id, structuredClone(proposal));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    for (const proposal of this.proposals.values()) {
      if (proposal.conversationId === conversationId) this.proposals.delete(proposal.id);
    }
  }

  snapshot(): unknown {
    return structuredClone([...this.proposals.entries()]);
  }

  restore(snapshot: unknown): void {
    this.proposals.clear();
    for (const [id, proposal] of snapshot as Array<[string, StoredPlanProposal]>) this.proposals.set(id, structuredClone(proposal));
  }
}

export interface PlanningContextReader {
  get(sessionId: string, conversationId: string): Promise<PlanningContext>;
}

export interface ConversationScopePort extends ConversationOwnershipPort {
  get(sessionId: string, conversationId: string): Promise<Pick<Conversation, 'id' | 'tripId'>>;
}

function publicProposal(proposal: StoredPlanProposal): PlanProposal {
  const { acceptedPlaceIds: _acceptedPlaceIds, idempotency: _idempotency, ...value } = proposal;
  return structuredClone(value);
}

function acceptanceRequest(input: AcceptProposalInput): string {
  return JSON.stringify({
    expectedProposalVersion: input.expectedProposalVersion,
    expectedPlanningContextVersion: input.expectedPlanningContextVersion,
    expectedPlanVersion: input.expectedPlanVersion,
    idempotencyKey: input.idempotencyKey,
  });
}

function acceptanceRequestHash(request: string): string {
  return createHash('sha256').update(request).digest('hex');
}

function planContext(context: PlanningContext): PlanContext {
  const travelerCount = context.travelerCount ?? (context.assumptions.includes('traveler_count_defaulted_to_1') ? 1 : undefined);
  if (!travelerCount) throw new ApplicationError('validation_error', 'planning context is incomplete');
  return { travelerCount, totalBudgetCents: context.totalBudgetCents ?? 0 };
}

export interface ProposalAcceptanceTransaction {
  acceptPlace?(input: {
    sessionId: string;
    conversationId: string;
    proposalId: string;
    placeId: string;
    expectedProposalVersion: number;
  }): Promise<CandidatePlace>;
  accept(input: {
    sessionId: string;
    conversationId: string;
    proposalId: string;
    expectedProposalVersion: number;
    expectedPlanningContextVersion: number;
    expectedPlanVersion: number;
    idempotencyKey: string;
    requestFingerprint: string;
    planVersion: PlanVersion;
  }): Promise<ProposalAcceptanceResult>;
}

export class PlanProposalService {
  constructor(
    private readonly repository: PlanProposalRepository,
    private readonly candidates: CandidateService,
    private readonly plans: PlanService,
    private readonly planningContexts: PlanningContextReader,
    private readonly conversations: ConversationScopePort,
    private readonly clock: { now(): Date; id(): string } = { now: () => new Date(), id: () => crypto.randomUUID() },
    private readonly acceptanceTransaction?: ProposalAcceptanceTransaction,
  ) {}

  async create(sessionId: string, draft: PlanProposalDraft): Promise<PlanProposal> {
    const parsed = PlanProposalDraftSchema.safeParse(draft);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid plan proposal');
    await this.assertConversationTrip(sessionId, parsed.data.conversationId, parsed.data.tripId);
    for (const previous of await this.repository.list(parsed.data.conversationId)) {
      if (previous.status === 'pending') {
        await this.repository.save({ ...previous, status: 'expired', version: previous.version + 1 }, previous.version);
      }
    }
    const createdAt = this.clock.now();
    const proposal: StoredPlanProposal = {
      ...parsed.data,
      id: this.clock.id(),
      version: 1,
      status: 'pending',
      createdAt: createdAt.toISOString(),
      // Review lifetime is server policy, not an instruction from model output.
      expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      acceptedPlaceIds: [],
      idempotency: {},
    };
    await this.repository.create(proposal);
    return publicProposal(proposal);
  }

  async current(sessionId: string, conversationId: string): Promise<PlanProposal | undefined> {
    await this.conversations.assertOwned(sessionId, conversationId);
    const pending = (await this.repository.list(conversationId)).filter(proposal => proposal.status === 'pending').at(-1);
    if (!pending) return undefined;
    if (await this.expireIfNeeded(pending)) return undefined;
    return publicProposal(pending);
  }

  async acceptPlace(sessionId: string, conversationId: string, proposalId: string, input: AcceptProposalPlaceInput): Promise<CandidatePlace> {
    const parsed = AcceptProposalPlaceInputSchema.safeParse(input);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid proposal place acceptance');
    await this.conversations.assertOwned(sessionId, conversationId);
    const proposal = await this.pending(conversationId, proposalId);
    if (proposal.version !== parsed.data.expectedProposalVersion) throw new ApplicationError('conflict', 'plan proposal version changed');
    const place = proposal.proposedPlaces.find(candidate => candidate.id === parsed.data.placeId);
    if (!place) throw new ApplicationError('validation_error', 'proposed place not found');

    if (this.acceptanceTransaction?.acceptPlace) {
      try {
        return await this.acceptanceTransaction.acceptPlace({
          sessionId,
          conversationId,
          proposalId,
          placeId: parsed.data.placeId,
          expectedProposalVersion: parsed.data.expectedProposalVersion,
        });
      } catch (error) {
        throw this.persistenceError(error);
      }
    }

    const proposalSnapshot = this.snapshot(this.repository, 'plan proposal repository');
    const candidateSnapshot = this.candidates.snapshot();
    try {
      const [candidate] = await this.candidates.addAcceptedProposalPlaces(sessionId, conversationId, [place]);
      if (!candidate) throw new ApplicationError('conflict', 'candidate could not be saved');
      await this.repository.save({
        ...proposal,
        acceptedPlaceIds: [...new Set([...proposal.acceptedPlaceIds, place.id])],
        version: proposal.version + 1,
      }, proposal.version);
      return candidate;
    } catch (error) {
      this.restore(this.repository, proposalSnapshot, 'plan proposal repository');
      this.candidates.restore(candidateSnapshot);
      throw error;
    }
  }

  async accept(sessionId: string, conversationId: string, proposalId: string, input: AcceptProposalInput): Promise<ProposalAcceptanceResult> {
    const parsed = AcceptProposalInputSchema.safeParse(input);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid proposal acceptance');
    await this.conversations.assertOwned(sessionId, conversationId);
    const proposal = await this.require(conversationId, proposalId);
    const request = acceptanceRequest(parsed.data);
    const replay = proposal.idempotency[parsed.data.idempotencyKey];
    if (replay) {
      if (replay.request !== request && replay.request !== acceptanceRequestHash(request)) throw new ApplicationError('conflict', 'idempotency key was reused with a different request');
      return structuredClone(replay.result);
    }
    if (await this.expireIfNeeded(proposal)) throw new ApplicationError('gone', 'plan proposal expired');
    if (proposal.status !== 'pending') throw new ApplicationError('conflict', 'plan proposal is no longer pending');
    if (proposal.version !== parsed.data.expectedProposalVersion) throw new ApplicationError('conflict', 'plan proposal version changed');

    const context = await this.planningContexts.get(sessionId, conversationId);
    if (context.version !== proposal.planningContextVersion || context.version !== parsed.data.expectedPlanningContextVersion) {
      throw new ApplicationError('conflict', 'planning context version changed');
    }
    await this.assertConversationTrip(sessionId, conversationId, proposal.tripId);

    if (this.acceptanceTransaction) {
      const contextValue = planContext(context);
      const planVersion = await this.plans.prepareProposalVersion(
        proposal.tripId,
        sessionId,
        proposal.itinerary,
        parsed.data.expectedPlanVersion,
        contextValue,
      );
      let result: ProposalAcceptanceResult;
      try {
        result = await this.acceptanceTransaction.accept({
          sessionId,
          conversationId,
          proposalId,
          expectedProposalVersion: parsed.data.expectedProposalVersion,
          expectedPlanningContextVersion: parsed.data.expectedPlanningContextVersion,
          expectedPlanVersion: parsed.data.expectedPlanVersion,
          idempotencyKey: parsed.data.idempotencyKey,
          requestFingerprint: request,
          planVersion,
        });
      } catch (error) {
        throw this.persistenceError(error);
      }
      await this.plans.adoptPersistedVersion(result.planVersion, sessionId, contextValue);
      return result;
    }

    const proposalSnapshot = this.snapshot(this.repository, 'plan proposal repository');
    const candidateSnapshot = this.candidates.snapshot();
    const planSnapshot = this.plans.snapshot();
    try {
      const candidates = await this.candidates.addAcceptedProposalPlaces(
        sessionId,
        conversationId,
        proposal.proposedPlaces.filter(place => !proposal.acceptedPlaceIds.includes(place.id)),
      );
      const planVersion = await this.plans.acceptProposal(
        proposal.tripId,
        sessionId,
        proposal.itinerary,
        parsed.data.expectedPlanVersion,
        planContext(context),
      );
      const accepted: StoredPlanProposal = {
        ...proposal,
        status: 'accepted',
        version: proposal.version + 1,
      };
      const result: ProposalAcceptanceResult = {
        proposal: publicProposal(accepted),
        planVersion,
        candidates: structuredClone(candidates),
      };
      accepted.idempotency = {
        ...proposal.idempotency,
        [parsed.data.idempotencyKey]: { request, result: structuredClone(result) },
      };
      await this.repository.save(accepted, proposal.version);
      return result;
    } catch (error) {
      this.restore(this.repository, proposalSnapshot, 'plan proposal repository');
      this.candidates.restore(candidateSnapshot);
      this.plans.restore(planSnapshot);
      throw error;
    }
  }

  async reject(sessionId: string, conversationId: string, proposalId: string, expectedVersion: number): Promise<PlanProposal> {
    await this.conversations.assertOwned(sessionId, conversationId);
    const proposal = await this.pending(conversationId, proposalId);
    if (proposal.version !== expectedVersion) throw new ApplicationError('conflict', 'plan proposal version changed');
    const rejected = { ...proposal, status: 'rejected' as const, version: proposal.version + 1 };
    await this.repository.save(rejected, proposal.version);
    return publicProposal(rejected);
  }

  async deleteConversation(sessionId: string, conversationId: string): Promise<void> {
    await this.conversations.assertOwned(sessionId, conversationId);
    await this.repository.deleteConversation(conversationId);
  }

  /** Trusted cleanup hook used after the Conversation ownership check has already run. */
  async purgeConversation(conversationId: string): Promise<void> {
    await this.repository.deleteConversation(conversationId);
  }

  private async pending(conversationId: string, proposalId: string): Promise<StoredPlanProposal> {
    const proposal = await this.require(conversationId, proposalId);
    if (await this.expireIfNeeded(proposal)) throw new ApplicationError('gone', 'plan proposal expired');
    if (proposal.status !== 'pending') throw new ApplicationError('conflict', 'plan proposal is no longer pending');
    return proposal;
  }

  private async require(conversationId: string, proposalId: string): Promise<StoredPlanProposal> {
    const proposal = await this.repository.get(proposalId);
    if (!proposal || proposal.conversationId !== conversationId) throw new ApplicationError('validation_error', 'plan proposal not found');
    if (this.repository.loadIdempotency) proposal.idempotency = await this.repository.loadIdempotency(proposalId);
    return proposal;
  }

  private async expireIfNeeded(proposal: StoredPlanProposal): Promise<boolean> {
    if (proposal.status !== 'pending' || Date.parse(proposal.expiresAt) > this.clock.now().getTime()) return false;
    await this.repository.save({ ...proposal, status: 'expired', version: proposal.version + 1 }, proposal.version);
    return true;
  }

  private async assertConversationTrip(sessionId: string, conversationId: string, tripId: string): Promise<void> {
    const conversation = await this.conversations.get(sessionId, conversationId);
    if (conversation.tripId !== tripId) throw new ApplicationError('conflict', 'proposal trip does not match the conversation trip');
  }

  private persistenceError(error: unknown): unknown {
    if (error instanceof ApplicationError) return error;
    if (error instanceof Error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'validation_error' || code === 'forbidden' || code === 'conflict' || code === 'gone') {
        return new ApplicationError(code, error.message);
      }
      if (error.name === 'RepositoryConflictError') return new ApplicationError('conflict', error.message);
    }
    return error;
  }

  private snapshot(repository: PlanProposalRepository, label: string): unknown {
    if (!repository.snapshot) throw new Error(`${label} does not support snapshots`);
    return repository.snapshot();
  }

  private restore(repository: PlanProposalRepository, snapshot: unknown, label: string): void {
    if (!repository.restore) throw new Error(`${label} does not support snapshots`);
    repository.restore(snapshot);
  }
}
