import { sql, type Kysely } from 'kysely';
import type { EventEnvelope } from '@travel/contracts';
import type { Database, EventAppendInput } from '../types.js';
import type { DatabaseTransaction } from '../db.js';
import { eventToRow } from '../types.js';

export interface PersistedStreamEvent {
  position: number;
  envelope: EventEnvelope;
}

function envelopeFromRow(row: {
  event_id: string; event_type: string; aggregate_type: string; aggregate_id: string; run_id: string | null;
  sequence: number; schema_version: number; occurred_at: string; request_id: string; correlation_id: string; payload_json: string;
}): EventEnvelope {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    ...(row.run_id ? { run_id: row.run_id } : {}),
    sequence: row.sequence,
    schema_version: row.schema_version,
    occurred_at: new Date(row.occurred_at).toISOString(),
    request_id: row.request_id,
    correlation_id: row.correlation_id,
    redacted_payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  };
}

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
    const { tripId, ...envelopeInput } = event;
    const aggregateLock = JSON.stringify([envelopeInput.aggregate_type, envelopeInput.aggregate_id]);
    await sql`select pg_advisory_xact_lock(hashtextextended(${aggregateLock}, 0))`.execute(tx);
    const latest = await tx
      .selectFrom('event_log')
      .select(eb => eb.fn.max<number>('sequence').as('sequence'))
      .where('aggregate_type', '=', envelopeInput.aggregate_type)
      .where('aggregate_id', '=', envelopeInput.aggregate_id)
      .executeTakeFirst();
    const persisted: EventEnvelope = { ...envelopeInput, sequence: Number(latest?.sequence ?? 0) + 1 };

    await tx.insertInto('event_log').values({ ...eventToRow(persisted), trip_id: tripId ?? null }).execute();
    await tx
      .insertInto('outbox_events')
      .values({
        event_id: persisted.event_id,
        event_type: persisted.event_type,
        aggregate_type: persisted.aggregate_type,
        aggregate_id: persisted.aggregate_id,
        trip_id: tripId ?? null,
        sequence: persisted.sequence,
        payload_json: JSON.stringify(persisted),
        published_at: null,
        created_at: new Date().toISOString(),
      })
      .execute();
    return persisted;
  }

  async ownsTrip(actorId: string, tripId: string): Promise<boolean> {
    const row = await this.db.selectFrom('trips').select('id').where('id', '=', tripId).where('owner_id', '=', actorId).executeTakeFirst();
    return Boolean(row);
  }

  async replayTrip(tripId: string, lastEventId?: string): Promise<{ events: PersistedStreamEvent[]; cursor: number }> {
    let cursor = 0;
    if (lastEventId) {
      const last = await this.db.selectFrom('event_log').select(['trip_id', 'stream_position']).where('event_id', '=', lastEventId).executeTakeFirst();
      if (!last || last.trip_id !== tripId) throw new Error('Last-Event-ID does not belong to Trip');
      cursor = Number(last.stream_position);
    }
    const rows = await this.db.selectFrom('event_log').selectAll().where('trip_id', '=', tripId).where('stream_position', '>', cursor).orderBy('stream_position').execute();
    const events = rows.map(row => ({ position: Number(row.stream_position), envelope: envelopeFromRow(row) }));
    return { events, cursor: events.at(-1)?.position ?? cursor };
  }

  async tripEventsAfter(tripId: string, afterPosition: number, limit = 100): Promise<PersistedStreamEvent[]> {
    const rows = await this.db.selectFrom('event_log').selectAll().where('trip_id', '=', tripId).where('stream_position', '>', afterPosition).orderBy('stream_position').limit(limit).execute();
    return rows.map(row => ({ position: Number(row.stream_position), envelope: envelopeFromRow(row) }));
  }

  async conversationEventsAfter(conversationId: string, afterSequence = 0, limit = 100): Promise<PersistedStreamEvent[]> {
    const rows = await this.db.selectFrom('event_log').selectAll()
      .where('aggregate_type', '=', 'conversation')
      .where('aggregate_id', '=', conversationId)
      .where('sequence', '>', afterSequence)
      .orderBy('sequence').limit(limit).execute();
    return rows.map(row => ({ position: row.sequence, envelope: envelopeFromRow(row) }));
  }

  async conversationEvent(eventId: string): Promise<PersistedStreamEvent | undefined> {
    const row = await this.db.selectFrom('event_log').selectAll()
      .where('event_id', '=', eventId)
      .where('aggregate_type', '=', 'conversation').executeTakeFirst();
    return row ? { position: row.sequence, envelope: envelopeFromRow(row) } : undefined;
  }

  async deleteConversationEvents(conversationId: string, tx?: DatabaseTransaction): Promise<void> {
    await (tx ?? this.db).deleteFrom('event_log')
      .where('aggregate_type', '=', 'conversation').where('aggregate_id', '=', conversationId).execute();
    await (tx ?? this.db).deleteFrom('outbox_events')
      .where('aggregate_type', '=', 'conversation').where('aggregate_id', '=', conversationId).execute();
  }
}
