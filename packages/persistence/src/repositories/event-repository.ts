import { sql, type Kysely } from 'kysely';
import type { EventEnvelope } from '@travel/contracts';
import type { Database, EventAppendInput } from '../types.js';
import type { DatabaseTransaction } from '../db.js';
import { eventToRow } from '../types.js';

export class EventRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async append(event: EventAppendInput): Promise<EventEnvelope> {
    return this.db.transaction().execute(async tx => {
      return this.appendAndPublishable(tx, event);
    });
  }

  async appendAndPublishable(
    tx: DatabaseTransaction,
    event: EventAppendInput,
  ): Promise<EventEnvelope> {
    const aggregateLock = JSON.stringify([event.aggregate_type, event.aggregate_id]);
    await sql`select pg_advisory_xact_lock(hashtextextended(${aggregateLock}, 0))`.execute(tx);
    const latest = await tx
      .selectFrom('event_log')
      .select(eb => eb.fn.max<number>('sequence').as('sequence'))
      .where('aggregate_type', '=', event.aggregate_type)
      .where('aggregate_id', '=', event.aggregate_id)
      .executeTakeFirst();
    const persisted = { ...event, sequence: Number(latest?.sequence ?? 0) + 1 };

    await tx.insertInto('event_log').values(eventToRow(persisted)).execute();
    await tx
      .insertInto('outbox_events')
      .values({
        event_id: persisted.event_id,
        event_type: persisted.event_type,
        aggregate_type: persisted.aggregate_type,
        aggregate_id: persisted.aggregate_id,
        sequence: persisted.sequence,
        payload_json: JSON.stringify(persisted),
        published_at: null,
        created_at: new Date().toISOString(),
      })
      .execute();
    return persisted;
  }
}
