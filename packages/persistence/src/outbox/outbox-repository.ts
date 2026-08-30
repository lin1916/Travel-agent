import type { Kysely } from 'kysely';
import { EventEnvelopeSchema, type EventEnvelope } from '@travel/contracts';
import { assertDurablePayloadSafe, type Database } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

export interface OutboxEnvelopeRow {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
  payload_json: string;
  created_at: string;
}

export function outboxRowToEnvelope(row: OutboxEnvelopeRow): EventEnvelope {
  const payload = JSON.parse(row.payload_json) as unknown;
  const current = EventEnvelopeSchema.safeParse(payload);
  if (current.success) {
    assertDurablePayloadSafe(current.data.redacted_payload, 'event.redacted_payload');
    return current.data;
  }
  assertDurablePayloadSafe(payload, 'event.redacted_payload');
  return EventEnvelopeSchema.parse({
    event_id: row.event_id,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    sequence: row.sequence,
    schema_version: 1,
    occurred_at: new Date(row.created_at).toISOString(),
    request_id: `legacy:${row.event_id}`,
    correlation_id: `legacy:${row.event_id}`,
    redacted_payload: payload,
  });
}

export class OutboxRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async append(tx: DatabaseTransaction, event: EventEnvelope, tripId?: string): Promise<void> {
    assertDurablePayloadSafe(event.redacted_payload, 'event.redacted_payload');
    await tx
      .insertInto('outbox_events')
      .values({
        event_id: event.event_id,
        event_type: event.event_type,
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        trip_id: tripId ?? null,
        sequence: event.sequence,
        payload_json: JSON.stringify(event),
        published_at: null,
        created_at: new Date().toISOString(),
      })
      .execute();
  }

  async pending(limit = 100): Promise<EventEnvelope[]> {
    const rows = await this.db.selectFrom('outbox_events').select(['event_id', 'event_type', 'aggregate_type', 'aggregate_id', 'sequence', 'payload_json', 'created_at']).where('published_at', 'is', null).orderBy('id').limit(limit).execute();
    return rows.map(outboxRowToEnvelope);
  }

  async markPublished(eventId: string): Promise<void> {
    await this.db
      .updateTable('outbox_events')
      .set({ published_at: new Date().toISOString() })
      .where('event_id', '=', eventId)
      .execute();
  }
}
