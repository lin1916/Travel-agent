import type { PlanningContext } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database, PlanningContextsTable } from '../types.js';
import type { DatabaseTransaction } from '../db.js';
import { RepositoryConflictError } from '../types.js';

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function cst(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().replace('Z', '+08:00');
}

function fromRow(row: PlanningContextsTable): PlanningContext & { sessionId: string } {
  return {
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    version: Number(row.version),
    ...(row.destination ? { destination: row.destination } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    ...(row.starts_at ? { startsAt: cst(row.starts_at) } : {}),
    ...(row.ends_at ? { endsAt: cst(row.ends_at) } : {}),
    ...(row.traveler_count === null ? {} : { travelerCount: Number(row.traveler_count) }),
    ...(row.total_budget_cents === null ? {} : { totalBudgetCents: Number(row.total_budget_cents) }),
    preferences: JSON.parse(row.preferences_json) as string[],
    assumptions: JSON.parse(row.assumptions_json) as Array<'traveler_count_defaulted_to_1'>,
    missingFields: JSON.parse(row.missing_fields_json) as PlanningContext['missingFields'],
    updatedAt: iso(row.updated_at),
  };
}

export class PlanningContextRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(record: PlanningContext & { sessionId: string }, tx?: DatabaseTransaction): Promise<void> {
    try {
      await (tx ?? this.db).insertInto('planning_contexts').values(this.values(record)).execute();
    } catch (error) {
      if (error instanceof Error && /duplicate|unique/i.test(error.message)) throw new RepositoryConflictError('planning context already exists');
      throw error;
    }
  }

  async get(conversationId: string, tx?: DatabaseTransaction): Promise<(PlanningContext & { sessionId: string }) | undefined> {
    const row = await (tx ?? this.db).selectFrom('planning_contexts').selectAll().where('conversation_id', '=', conversationId).executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }

  async getForSession(sessionId: string, conversationId: string, tx?: DatabaseTransaction): Promise<(PlanningContext & { sessionId: string }) | undefined> {
    const row = await (tx ?? this.db).selectFrom('planning_contexts').selectAll()
      .where('session_id', '=', sessionId).where('conversation_id', '=', conversationId).executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }

  async save(record: PlanningContext & { sessionId: string }, expectedVersion: number, tx?: DatabaseTransaction): Promise<void> {
    const result = await (tx ?? this.db).updateTable('planning_contexts').set(this.values(record))
      .where('conversation_id', '=', record.conversationId)
      .where('session_id', '=', record.sessionId)
      .where('version', '=', expectedVersion)
      .executeTakeFirst();
    if (!result || Number(result.numUpdatedRows) === 0) throw new RepositoryConflictError('planning context version changed');
  }

  async delete(conversationId: string, tx?: DatabaseTransaction): Promise<void> {
    await (tx ?? this.db).deleteFrom('planning_contexts').where('conversation_id', '=', conversationId).execute();
  }

  private values(record: PlanningContext & { sessionId: string }) {
    return {
      conversation_id: record.conversationId,
      session_id: record.sessionId,
      version: record.version,
      destination: record.destination ?? null,
      origin: record.origin ?? null,
      starts_at: record.startsAt ?? null,
      ends_at: record.endsAt ?? null,
      traveler_count: record.travelerCount ?? null,
      total_budget_cents: record.totalBudgetCents ?? null,
      preferences_json: JSON.stringify(record.preferences),
      assumptions_json: JSON.stringify(record.assumptions),
      missing_fields_json: JSON.stringify(record.missingFields),
      updated_at: record.updatedAt,
    };
  }
}

export { PlanningContextRepository as PostgresPlanningContextRepository };
