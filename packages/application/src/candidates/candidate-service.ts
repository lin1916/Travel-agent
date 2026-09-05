import {
  CandidatePlaceSchema,
  CandidateSourceSchema,
  PlaceSchema,
  type CandidatePlace,
  type CandidateSource,
  type Place,
} from '@travel/contracts';
import type { ConversationOwnershipPort } from '../planning-context/planning-context-service.js';
import { ApplicationError } from '../errors.js';

export interface CandidateRepository {
  create(candidate: CandidatePlace): Promise<void>;
  get(id: string): Promise<CandidatePlace | undefined>;
  list(conversationId: string): Promise<CandidatePlace[]>;
  save(candidate: CandidatePlace): Promise<void>;
  delete(id: string): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  snapshot?(): unknown;
  restore?(snapshot: unknown): void;
}

export class InMemoryCandidateRepository implements CandidateRepository {
  private readonly candidates = new Map<string, CandidatePlace>();

  async create(candidate: CandidatePlace): Promise<void> {
    if (this.candidates.has(candidate.id)) throw new ApplicationError('conflict', 'candidate already exists');
    this.candidates.set(candidate.id, structuredClone(candidate));
  }

  async get(id: string): Promise<CandidatePlace | undefined> {
    const candidate = this.candidates.get(id);
    return candidate ? structuredClone(candidate) : undefined;
  }

  async list(conversationId: string): Promise<CandidatePlace[]> {
    return [...this.candidates.values()]
      .filter(candidate => candidate.conversationId === conversationId)
      .map(candidate => structuredClone(candidate));
  }

  async save(candidate: CandidatePlace): Promise<void> {
    if (!this.candidates.has(candidate.id)) throw new ApplicationError('validation_error', 'candidate not found');
    this.candidates.set(candidate.id, structuredClone(candidate));
  }

  async delete(id: string): Promise<void> {
    this.candidates.delete(id);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    for (const candidate of this.candidates.values()) {
      if (candidate.conversationId === conversationId) this.candidates.delete(candidate.id);
    }
  }

  snapshot(): unknown {
    return structuredClone([...this.candidates.entries()]);
  }

  restore(snapshot: unknown): void {
    this.candidates.clear();
    for (const [id, candidate] of snapshot as Array<[string, CandidatePlace]>) this.candidates.set(id, structuredClone(candidate));
  }
}

export interface AddCandidateInput {
  place: Place;
  source: CandidateSource;
  note?: string;
  priority?: number;
}

export interface UpdateCandidateInput {
  note?: string;
  priority?: number;
}

function sameProviderPlace(left: CandidatePlace, place: Place): boolean {
  return left.place.provider === place.provider && left.place.providerPlaceId === place.providerPlaceId;
}

export class CandidateService {
  constructor(
    private readonly repository: CandidateRepository,
    private readonly conversations: ConversationOwnershipPort,
    private readonly clock: { now(): Date; id(): string } = { now: () => new Date(), id: () => crypto.randomUUID() },
  ) {}

  async add(sessionId: string, conversationId: string, input: AddCandidateInput): Promise<CandidatePlace> {
    if (input.source !== 'user_search') throw new ApplicationError('validation_error', 'agent places require proposal acceptance');
    return this.addPlace(sessionId, conversationId, input.place, input.source, input.note, input.priority);
  }

  async addAcceptedProposalPlaces(sessionId: string, conversationId: string, places: Place[]): Promise<CandidatePlace[]> {
    const saved: CandidatePlace[] = [];
    for (const place of places) saved.push(await this.addPlace(sessionId, conversationId, place, 'accepted_agent_proposal'));
    return saved;
  }

  async list(sessionId: string, conversationId: string): Promise<CandidatePlace[]> {
    await this.conversations.assertOwned(sessionId, conversationId);
    return this.repository.list(conversationId);
  }

  async remove(sessionId: string, conversationId: string, candidateId: string): Promise<void> {
    await this.conversations.assertOwned(sessionId, conversationId);
    const candidate = await this.require(conversationId, candidateId);
    await this.repository.delete(candidate.id);
  }

  async setPriority(sessionId: string, conversationId: string, candidateId: string, priority: number): Promise<CandidatePlace> {
    await this.conversations.assertOwned(sessionId, conversationId);
    if (!Number.isInteger(priority) || priority < 0) throw new ApplicationError('validation_error', 'candidate priority must be a non-negative integer');
    const candidate = await this.require(conversationId, candidateId);
    const updated = { ...candidate, priority };
    await this.repository.save(updated);
    return structuredClone(updated);
  }

  async update(sessionId: string, conversationId: string, candidateId: string, input: UpdateCandidateInput): Promise<CandidatePlace> {
    await this.conversations.assertOwned(sessionId, conversationId);
    if (input.note === undefined && input.priority === undefined) throw new ApplicationError('validation_error', 'candidate update is required');
    if (input.note !== undefined && (!input.note.trim() || input.note.length > 2_000)) throw new ApplicationError('validation_error', 'invalid candidate note');
    if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0)) throw new ApplicationError('validation_error', 'candidate priority must be a non-negative integer');
    const candidate = await this.require(conversationId, candidateId);
    const updated = {
      ...candidate,
      ...(input.note === undefined ? {} : { note: input.note.trim() }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
    };
    await this.repository.save(updated);
    return structuredClone(updated);
  }

  async deleteConversation(sessionId: string, conversationId: string): Promise<void> {
    await this.conversations.assertOwned(sessionId, conversationId);
    await this.repository.deleteConversation(conversationId);
  }

  /** Trusted cleanup hook used after the Conversation ownership check has already run. */
  async purgeConversation(conversationId: string): Promise<void> {
    await this.repository.deleteConversation(conversationId);
  }

  snapshot(): unknown {
    if (!this.repository.snapshot) throw new Error('candidate repository does not support snapshots');
    return this.repository.snapshot();
  }

  restore(snapshot: unknown): void {
    if (!this.repository.restore) throw new Error('candidate repository does not support snapshots');
    this.repository.restore(snapshot);
  }

  private async addPlace(sessionId: string, conversationId: string, place: Place, source: CandidateSource, note?: string, priority?: number): Promise<CandidatePlace> {
    await this.conversations.assertOwned(sessionId, conversationId);
    const parsedPlace = PlaceSchema.safeParse(place);
    if (!parsedPlace.success) throw new ApplicationError('validation_error', parsedPlace.error.issues[0]?.message ?? 'invalid place');
    const parsedSource = CandidateSourceSchema.safeParse(source);
    if (!parsedSource.success) throw new ApplicationError('validation_error', 'invalid candidate source');
    if (note !== undefined && (!note.trim() || note.length > 2_000)) throw new ApplicationError('validation_error', 'invalid candidate note');
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0)) throw new ApplicationError('validation_error', 'candidate priority must be a non-negative integer');
    const existing = (await this.repository.list(conversationId)).find(candidate => sameProviderPlace(candidate, parsedPlace.data));
    if (existing) return existing;
    const candidate = CandidatePlaceSchema.parse({
      id: this.clock.id(),
      conversationId,
      place: parsedPlace.data,
      source: parsedSource.data,
      ...(note ? { note: note.trim() } : {}),
      ...(priority === undefined ? {} : { priority }),
      createdAt: this.clock.now().toISOString(),
    });
    await this.repository.create(candidate);
    return structuredClone(candidate);
  }

  private async require(conversationId: string, candidateId: string): Promise<CandidatePlace> {
    const candidate = await this.repository.get(candidateId);
    if (!candidate || candidate.conversationId !== conversationId) throw new ApplicationError('validation_error', 'candidate not found');
    return candidate;
  }
}
