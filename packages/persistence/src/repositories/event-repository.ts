import type { Kysely } from 'kysely';
import type { EventEnvelope } from '@travel/contracts';
import type { Database } from '../types.js';
import type { DatabaseTransaction } from '../db.js';
import { eventToRow } from '../types.js';

export class EventRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async append(event: EventEnvelope): Promise<{ sequence: number }> {
    return this.db.transaction().execute(async tx => {
      await this.appendAndPublishable(tx, event);
      return { sequence: event.sequence };
    });
  }

  async appendAndPublishable(tx: DatabaseTransaction, event: EventEnvelope): Promise<void> {
    await tx.insertInto('event_log').values(eventToRow(event)).execute();
    await tx
      .insertInto('outbox_events')
      .values({
        event_id: event.event_id,
        event_type: event.event_type,
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        sequence: event.sequence,
        payload_json: JSON.stringify(event),
        published_at: null,
        created_at: new Date().toISOString(),
      })
      .execute();
  }
}
