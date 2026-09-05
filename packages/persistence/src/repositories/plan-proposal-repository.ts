import type { PlanProposal, PlanProposalDraft, ProposalAcceptanceResult } from '@travel/contracts';
import { PlanProposalDraftSchema } from '@travel/contracts';
import { sql, type Kysely } from 'kysely';
import type { Database, PlanProposalsTable } from '../types.js';
import type { DatabaseTransaction } from '../db.js';
import { RepositoryConflictError } from '../types.js';

export interface StoredPlanProposal extends PlanProposal {
  acceptedPlaceIds: string[];
  idempotency: Record<string, { request: string; result: ProposalAcceptanceResult }>;
}

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }

function fromRow(row: PlanProposalsTable): StoredPlanProposal {
  const draft = PlanProposalDraftSchema.parse({
    conversationId: row.conversation_id,
    tripId: row.trip_id,
    planningContextVersion: Number(row.planning_context_version),
    proposedPlaces: JSON.parse(row.proposed_places_json),
    itinerary: JSON.parse(row.itinerary_json),
    budgetSummary: JSON.parse(row.budget_summary_json),
    warnings: JSON.parse(row.warnings_json),
    ...(row.reasoning_summary ? { reasoningSummary: row.reasoning_summary } : {}),
    expiresAt: iso(row.expires_at),
  });
  return {
    ...draft,
    id: row.id,
    version: Number(row.version),
    status: row.status,
    createdAt: iso(row.created_at),
    acceptedPlaceIds: JSON.parse(row.accepted_place_ids_json) as string[],
    idempotency: {},
  };
}

export class PlanProposalRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(proposal: StoredPlanProposal, tx?: DatabaseTransaction): Promise<void> {
    const draft = PlanProposalDraftSchema.parse({
      conversationId: proposal.conversationId,
      tripId: proposal.tripId,
      planningContextVersion: proposal.planningContextVersion,
      proposedPlaces: proposal.proposedPlaces,
      itinerary: proposal.itinerary,
      budgetSummary: proposal.budgetSummary,
      warnings: proposal.warnings,
      ...(proposal.reasoningSummary ? { reasoningSummary: proposal.reasoningSummary } : {}),
      expiresAt: proposal.expiresAt,
    });
    try {
      await (tx ?? this.db).insertInto('plan_proposals').values({
        id: proposal.id,
        conversation_id: draft.conversationId,
        trip_id: draft.tripId,
        planning_context_version: draft.planningContextVersion,
        proposed_places_json: JSON.stringify(draft.proposedPlaces),
        itinerary_json: JSON.stringify(draft.itinerary),
        budget_summary_json: JSON.stringify(draft.budgetSummary),
        warnings_json: JSON.stringify(draft.warnings),
        reasoning_summary: draft.reasoningSummary ?? null,
        status: proposal.status,
        version: proposal.version,
        accepted_place_ids_json: JSON.stringify(proposal.acceptedPlaceIds),
        created_at: proposal.createdAt,
        expires_at: draft.expiresAt,
      }).execute();
    } catch (error) {
      if (error instanceof Error && /duplicate|unique/i.test(error.message)) throw new RepositoryConflictError('plan proposal already exists');
      throw error;
    }
  }

  async get(id: string, tx?: DatabaseTransaction): Promise<StoredPlanProposal | undefined> {
    const row = await (tx ?? this.db).selectFrom('plan_proposals').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }

  async getForConversation(conversationId: string, id: string, tx?: DatabaseTransaction): Promise<StoredPlanProposal | undefined> {
    const row = await (tx ?? this.db).selectFrom('plan_proposals').selectAll()
      .where('conversation_id', '=', conversationId).where('id', '=', id).executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }

  async list(conversationId: string, tx?: DatabaseTransaction): Promise<StoredPlanProposal[]> {
    const rows = await (tx ?? this.db).selectFrom('plan_proposals').selectAll()
      .where('conversation_id', '=', conversationId).orderBy('created_at', 'asc').execute();
    return rows.map(fromRow);
  }

  async save(proposal: StoredPlanProposal, expectedVersion: number, tx?: DatabaseTransaction): Promise<void> {
    const result = await (tx ?? this.db).updateTable('plan_proposals').set({
      status: proposal.status,
      version: proposal.version,
      accepted_place_ids_json: JSON.stringify(proposal.acceptedPlaceIds),
      reasoning_summary: proposal.reasoningSummary ?? null,
    }).where('id', '=', proposal.id).where('conversation_id', '=', proposal.conversationId).where('version', '=', expectedVersion).executeTakeFirst();
    if (!result || Number(result.numUpdatedRows) === 0) throw new RepositoryConflictError('plan proposal version changed');
  }

  async expirePending(before: string, tx?: DatabaseTransaction): Promise<number> {
    const result = await (tx ?? this.db).updateTable('plan_proposals')
      .set({ status: 'expired', version: sql<number>`version + 1` })
      .where('status', '=', 'pending').where('expires_at', '<=', before).executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  async loadIdempotency(proposalId: string): Promise<Record<string, { request: string; result: ProposalAcceptanceResult }>> {
    const rows = await this.db.selectFrom('proposal_idempotency_keys').selectAll().where('proposal_id', '=', proposalId).execute();
    return Object.fromEntries(rows.map(row => [row.idempotency_key, {
      request: row.request_hash,
      result: JSON.parse(row.response_json) as ProposalAcceptanceResult,
    }]));
  }

  async deleteConversation(conversationId: string, tx?: DatabaseTransaction): Promise<void> {
    await (tx ?? this.db).deleteFrom('plan_proposals').where('conversation_id', '=', conversationId).execute();
  }
}

export { PlanProposalRepository as PostgresPlanProposalRepository };
