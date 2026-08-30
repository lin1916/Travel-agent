import { createHash } from 'node:crypto';
import type { NormalizedOffer } from '@travel/contracts';
import { sql, type Kysely } from 'kysely';
import { assertDurablePayloadSafe, type Database } from '../types.js';
import { EventRepository } from './event-repository.js';

function searchEventId(taskId: string): string {
  return `search:${createHash('sha256').update(taskId).digest('hex')}`;
}

export class OfferRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async saveSearchResult(taskId: string, tripId: string, offers: readonly NormalizedOffer[]): Promise<void> {
    offers.forEach(offer => assertDurablePayloadSafe(offer, 'offer'));
    await this.db.transaction().execute(async tx => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`search:${taskId}`}, 0))`.execute(tx);
      const eventId = searchEventId(taskId);
      const existing = await tx.selectFrom('event_log').select('event_id').where('event_id', '=', eventId).executeTakeFirst();
      if (existing) return;
      for (const offer of offers) {
        await tx.insertInto('offers').values({
          trip_id: tripId,
          offer_id: offer.id,
          kind: offer.kind,
          supplier_id: offer.supplierId,
          snapshot_hash: offer.snapshotHash,
          source: offer.source,
          updated_at: offer.updatedAt,
          payload_json: JSON.stringify(offer),
          created_at: new Date().toISOString(),
        }).onConflict(oc => oc.columns(['trip_id', 'offer_id']).doUpdateSet({
          kind: offer.kind,
          supplier_id: offer.supplierId,
          snapshot_hash: offer.snapshotHash,
          source: offer.source,
          updated_at: offer.updatedAt,
          payload_json: JSON.stringify(offer),
        })).execute();
      }
      await new EventRepository(this.db).appendAndPublishable(tx, {
        event_id: eventId,
        event_type: 'SearchCompleted',
        aggregate_type: 'Trip',
        aggregate_id: tripId,
        tripId,
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        request_id: taskId,
        correlation_id: taskId,
        redacted_payload: { taskId, offerCount: offers.length, kinds: [...new Set(offers.map(offer => offer.kind))] },
      });
    });
  }
}
