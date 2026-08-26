import type { Kysely } from 'kysely';
import type { EventEnvelope } from '@travel/contracts';
import type { Database } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

export class OutboxRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async append(tx: DatabaseTransaction, event: EventEnvelope): Promise<void> {
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

  async markPublished(eventId: string): Promise<void> {
    await this.db
      .updateTable('outbox_events')
      .set({ published_at: new Date().toISOString() })
      .where('event_id', '=', eventId)
      .execute();
  }
}
