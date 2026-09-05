import { createHash, randomUUID } from 'node:crypto';
import type { CandidatePlace, PlanProposal, ProposalAcceptanceResult } from '@travel/contracts';
import { CandidatePlaceSchema, PlanProposalDraftSchema, PlanVersionSchema, PlaceSchema } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../types.js';
import { PlanRepository } from './plan-repository.js';
import { EventRepository } from './event-repository.js';

export interface ProposalAcceptanceInput {
  sessionId: string;
  conversationId: string;
  proposalId: string;
  expectedProposalVersion: number;
  expectedPlanningContextVersion: number;
  expectedPlanVersion: number;
  idempotencyKey: string;
  requestFingerprint: string;
  planVersion: ProposalAcceptanceResult['planVersion'];
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

type TransactionOutcome<T> = { status: 'completed'; value: T } | { status: 'expired' };

export class ProposalAcceptanceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async acceptPlace(input: { sessionId: string; conversationId: string; proposalId: string; placeId: string; expectedProposalVersion: number }): Promise<CandidatePlace> {
    const outcome: TransactionOutcome<CandidatePlace> = await this.db.transaction().execute(async tx => {
      const proposal = await tx.selectFrom('plan_proposals').selectAll()
        .where('id', '=', input.proposalId).where('conversation_id', '=', input.conversationId).forUpdate().executeTakeFirst();
      if (!proposal) throw this.error('validation_error', 'plan proposal not found');
      const conversation = await tx.selectFrom('agent_conversations').select('trip_id')
        .where('id', '=', input.conversationId).where('session_id', '=', input.sessionId).executeTakeFirst();
      if (!conversation) throw this.error('forbidden', 'conversation belongs to another session');
      if (conversation.trip_id !== proposal.trip_id) throw this.error('conflict', 'proposal trip does not match the conversation trip');
      if (Date.parse(String(proposal.expires_at)) <= Date.now()) {
        await tx.updateTable('plan_proposals').set({ status: 'expired', version: proposal.version + 1 })
          .where('id', '=', proposal.id).where('version', '=', proposal.version).execute();
        return { status: 'expired' as const };
      }
      if (proposal.status !== 'pending' || Number(proposal.version) !== input.expectedProposalVersion) throw this.error('conflict', 'plan proposal version changed');
      const places = JSON.parse(proposal.proposed_places_json) as unknown[];
      const place = places.find(value => value && typeof value === 'object' && (value as { id?: unknown }).id === input.placeId);
      if (!place) throw this.error('validation_error', 'proposed place not found');
      const normalized = PlaceSchema.parse(place);
      const existing = await tx.selectFrom('candidate_places').selectAll()
        .where('conversation_id', '=', input.conversationId).where('provider', '=', normalized.provider)
        .where('provider_place_id', '=', normalized.providerPlaceId).executeTakeFirst();
      let candidate: CandidatePlace;
      if (existing) {
        candidate = CandidatePlaceSchema.parse({
          id: existing.id, conversationId: existing.conversation_id, place: JSON.parse(existing.place_json), source: existing.source,
          ...(existing.note ? { note: existing.note } : {}), ...(existing.priority === null ? {} : { priority: Number(existing.priority) }), createdAt: new Date(existing.created_at).toISOString(),
        });
      } else {
        candidate = CandidatePlaceSchema.parse({ id: randomUUID(), conversationId: input.conversationId, place: normalized, source: 'accepted_agent_proposal', createdAt: new Date().toISOString() });
        await tx.insertInto('candidate_places').values({ id: candidate.id, conversation_id: input.conversationId, place_json: JSON.stringify(normalized), provider: normalized.provider, provider_place_id: normalized.providerPlaceId, source: candidate.source, note: null, priority: null, created_at: candidate.createdAt }).execute();
      }
      const accepted = JSON.parse(proposal.accepted_place_ids_json) as string[];
      await tx.updateTable('plan_proposals').set({ accepted_place_ids_json: JSON.stringify([...new Set([...accepted, normalized.id])]), version: Number(proposal.version) + 1 })
        .where('id', '=', proposal.id).where('version', '=', proposal.version).executeTakeFirstOrThrow();
      return { status: 'completed' as const, value: candidate };
    });
    if (outcome.status === 'expired') throw this.error('gone', 'plan proposal expired');
    return outcome.value;
  }

  async accept(input: ProposalAcceptanceInput): Promise<ProposalAcceptanceResult> {
    const outcome: TransactionOutcome<ProposalAcceptanceResult> = await this.db.transaction().execute(async tx => {
      const requestHash = hash(input.requestFingerprint);
      const proposalRow = await tx.selectFrom('plan_proposals').selectAll()
        .where('id', '=', input.proposalId)
        .where('conversation_id', '=', input.conversationId)
        .forUpdate().executeTakeFirst();
      if (!proposalRow) throw this.error('validation_error', 'plan proposal not found');
      const conversation = await tx.selectFrom('agent_conversations').select(['trip_id'])
        .where('id', '=', input.conversationId).where('session_id', '=', input.sessionId).executeTakeFirst();
      if (!conversation) throw this.error('forbidden', 'conversation belongs to another session');
      if (conversation.trip_id !== proposalRow.trip_id) throw this.error('conflict', 'proposal trip does not match the conversation trip');

      const replay = await tx.selectFrom('proposal_idempotency_keys').selectAll()
        .where('conversation_id', '=', input.conversationId)
        .where('proposal_id', '=', input.proposalId)
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst();
      if (replay) {
        if (replay.request_hash !== requestHash) throw this.error('conflict', 'idempotency key was reused with a different request');
        return { status: 'completed' as const, value: JSON.parse(replay.response_json) as ProposalAcceptanceResult };
      }
      if (Date.parse(String(proposalRow.expires_at)) <= Date.now()) {
        await tx.updateTable('plan_proposals').set({ status: 'expired', version: proposalRow.version + 1 })
          .where('id', '=', proposalRow.id).where('version', '=', proposalRow.version).execute();
        return { status: 'expired' as const };
      }
      if (proposalRow.status !== 'pending' || proposalRow.version !== input.expectedProposalVersion) {
        throw this.error('conflict', 'plan proposal version changed');
      }
      const context = await tx.selectFrom('planning_contexts').select('version')
        .where('conversation_id', '=', input.conversationId).where('session_id', '=', input.sessionId).forUpdate().executeTakeFirst();
      if (!context || context.version !== input.expectedPlanningContextVersion || context.version !== proposalRow.planning_context_version) {
        throw this.error('conflict', 'planning context version changed');
      }
      const currentPlan = await tx.selectFrom('plan_versions').select('version')
        .where('trip_id', '=', proposalRow.trip_id).where('owner_id', '=', input.sessionId).orderBy('version', 'desc').forUpdate().executeTakeFirst();
      if (Number(currentPlan?.version ?? 0) !== input.expectedPlanVersion) throw this.error('conflict', 'plan version changed');
      if (input.planVersion.version !== input.expectedPlanVersion + 1 || input.planVersion.tripId !== proposalRow.trip_id) {
        throw this.error('conflict', 'prepared plan version does not follow current plan');
      }

      const draft = PlanProposalDraftSchema.parse({
        conversationId: proposalRow.conversation_id,
        tripId: proposalRow.trip_id,
        planningContextVersion: proposalRow.planning_context_version,
        proposedPlaces: JSON.parse(proposalRow.proposed_places_json),
        itinerary: JSON.parse(proposalRow.itinerary_json),
        budgetSummary: JSON.parse(proposalRow.budget_summary_json),
        warnings: JSON.parse(proposalRow.warnings_json),
        ...(proposalRow.reasoning_summary ? { reasoningSummary: proposalRow.reasoning_summary } : {}),
        expiresAt: new Date(proposalRow.expires_at).toISOString(),
      });
      const acceptedPlaceIds = JSON.parse(proposalRow.accepted_place_ids_json) as string[];
      const candidates: CandidatePlace[] = [];
      for (const place of draft.proposedPlaces.filter(value => !acceptedPlaceIds.includes(value.id))) {
        const existing = await tx.selectFrom('candidate_places').selectAll()
          .where('conversation_id', '=', input.conversationId)
          .where('provider', '=', place.provider)
          .where('provider_place_id', '=', place.providerPlaceId).executeTakeFirst();
        if (existing) {
          candidates.push(CandidatePlaceSchema.parse({
            id: existing.id,
            conversationId: existing.conversation_id,
            place: JSON.parse(existing.place_json),
            source: existing.source,
            ...(existing.note ? { note: existing.note } : {}),
            ...(existing.priority === null ? {} : { priority: Number(existing.priority) }),
            createdAt: new Date(existing.created_at).toISOString(),
          }));
          continue;
        }
        const candidate = CandidatePlaceSchema.parse({
          id: randomUUID(), conversationId: input.conversationId, place,
          source: 'accepted_agent_proposal', createdAt: new Date().toISOString(),
        });
        await tx.insertInto('candidate_places').values({
          id: candidate.id, conversation_id: candidate.conversationId, place_json: JSON.stringify(candidate.place),
          provider: candidate.place.provider, provider_place_id: candidate.place.providerPlaceId,
          source: candidate.source, note: null, priority: null, created_at: candidate.createdAt,
        }).execute();
        candidates.push(candidate);
      }

      const planVersion = PlanVersionSchema.parse(input.planVersion);
      await new PlanRepository(this.db).append(planVersion, input.sessionId, tx);
      await new EventRepository(this.db).appendAndPublishable(tx, {
        event_id: planVersion.id,
        event_type: 'PlanVersionCreated',
        aggregate_type: 'Trip',
        aggregate_id: planVersion.tripId,
        schema_version: 1,
        occurred_at: planVersion.createdAt,
        request_id: planVersion.id,
        correlation_id: input.conversationId,
        redacted_payload: {
          version: planVersion.version,
          command: planVersion.changeSet.command,
          changedItemIds: [...planVersion.changeSet.changedItemIds],
          warningCodes: planVersion.warnings.map(warning => warning.code),
          budgetWarnings: [...planVersion.budget.warnings],
          estimatedTotalCents: planVersion.budget.estimatedTotal.amountCents,
        },
        tripId: planVersion.tripId,
      });
      const acceptedProposal: PlanProposal = {
        ...draft,
        id: proposalRow.id,
        version: proposalRow.version + 1,
        status: 'accepted',
        createdAt: new Date(proposalRow.created_at).toISOString(),
      };
      const result: ProposalAcceptanceResult = { proposal: acceptedProposal, planVersion, candidates };
      const updated = await tx.updateTable('plan_proposals').set({
        status: 'accepted',
        version: acceptedProposal.version,
        accepted_place_ids_json: JSON.stringify(draft.proposedPlaces.map(place => place.id)),
      })
        .where('id', '=', proposalRow.id).where('version', '=', proposalRow.version).executeTakeFirst();
      if (!updated || Number(updated.numUpdatedRows) === 0) throw this.error('conflict', 'plan proposal version changed');
      await tx.insertInto('proposal_idempotency_keys').values({
        conversation_id: input.conversationId,
        proposal_id: input.proposalId,
        idempotency_key: input.idempotencyKey,
        request_hash: requestHash,
        response_json: JSON.stringify(result),
        created_at: new Date().toISOString(),
      }).execute();
      return { status: 'completed' as const, value: result };
    });
    if (outcome.status === 'expired') throw this.error('gone', 'plan proposal expired');
    return outcome.value;
  }

  private error(code: 'validation_error' | 'forbidden' | 'conflict' | 'gone', message: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
  }
}
