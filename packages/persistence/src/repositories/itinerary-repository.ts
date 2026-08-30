import type { ItineraryItem } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

function toItem(row: Awaited<ReturnType<Kysely<Database>['selectFrom']>> extends never ? never : any): ItineraryItem {
  return {
    id: row.id,
    tripId: row.trip_id,
    version: row.version,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location_json ? JSON.parse(row.location_json) : undefined,
    offerId: row.offer_id ?? undefined,
    supplierOrderId: row.supplier_order_id ?? undefined,
    confirmed: row.confirmed,
  };
}

export class ItineraryRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async add(item: ItineraryItem, tx?: DatabaseTransaction): Promise<ItineraryItem> {
    const row = await (tx ?? this.db).insertInto('itinerary_items').values({
      id: item.id, trip_id: item.tripId, version: item.version, category: item.category,
      starts_at: item.startsAt, ends_at: item.endsAt,
      location_json: item.location ? JSON.stringify(item.location) : null,
      offer_id: item.offerId ?? null, supplier_order_id: item.supplierOrderId ?? null, confirmed: item.confirmed,
    }).returningAll().executeTakeFirstOrThrow();
    return toItem(row);
  }

  async list(tripId: string, tx?: DatabaseTransaction): Promise<ItineraryItem[]> {
    const rows = await (tx ?? this.db).selectFrom('itinerary_items').selectAll().where('trip_id', '=', tripId).orderBy('starts_at').execute();
    return rows.map(toItem);
  }
}
