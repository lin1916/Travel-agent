import { createHash } from 'node:crypto';
import { PlaceSchema, RoutePlanSchema, type Place, type RouteMode, type RoutePlan } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

function routeId(tripId: string, ownerId: string, route: RoutePlan): string {
  return createHash('sha256').update([tripId, ownerId, route.originPlaceId, route.destinationPlaceId, route.mode].join('\u0000')).digest('hex');
}

export class MapRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async savePlace(tripId: string, ownerId: string, input: Place, tx?: DatabaseTransaction): Promise<void> {
    const place = PlaceSchema.parse(input);
    await this.assertTripOwner(tripId, ownerId, tx);
    await (tx ?? this.db).insertInto('places').values({
      id: place.id, trip_id: tripId, owner_id: ownerId, name: place.name, category: place.category,
      address: place.address, city: place.city, latitude: place.latitude, longitude: place.longitude,
      provider_place_id: place.providerPlaceId, source_updated_at: place.sourceUpdatedAt,
    }).onConflict(oc => oc.constraint('places_trip_owner_provider_uq').doUpdateSet({
      id: place.id, name: place.name, category: place.category, address: place.address, city: place.city,
      latitude: place.latitude, longitude: place.longitude, source_updated_at: place.sourceUpdatedAt,
    })).execute();
  }

  async upsertPlace(tripId: string, ownerId: string, place: Place, tx?: DatabaseTransaction): Promise<void> {
    return this.savePlace(tripId, ownerId, place, tx);
  }

  async listPlaces(tripId: string, ownerId: string): Promise<Place[]> {
    const rows = await this.db.selectFrom('places').selectAll().where('trip_id', '=', tripId).where('owner_id', '=', ownerId).orderBy('name').execute();
    return rows.map(row => PlaceSchema.parse({
      id: row.id, name: row.name, category: row.category, address: row.address, city: row.city,
      latitude: row.latitude, longitude: row.longitude,
      location: { latitude: row.latitude, longitude: row.longitude, coordinateSystem: 'GCJ-02' },
      coordinateSystem: 'gcj02', provider: 'amap', providerPlaceId: row.provider_place_id,
      sourceUpdatedAt: new Date(row.source_updated_at).toISOString(),
    }));
  }

  async saveRoute(tripId: string, ownerId: string, input: RoutePlan, tx?: DatabaseTransaction): Promise<void> {
    const route = RoutePlanSchema.parse(input);
    await this.assertTripOwner(tripId, ownerId, tx);
    const connection = tx ?? this.db;
    await connection.insertInto('route_plans').values({
      id: routeId(tripId, ownerId, route), trip_id: tripId, owner_id: ownerId,
      origin_place_id: route.originPlaceId, destination_place_id: route.destinationPlaceId, mode: route.mode,
      status: route.status, origin_json: JSON.stringify(route.origin), destination_json: JSON.stringify(route.destination),
      distance_meters: route.status === 'available' ? route.distanceMeters : null,
      duration_minutes: route.status === 'available' ? route.durationMinutes : null,
      polyline: route.status === 'available' ? route.polyline : null,
      estimated_cost_cents: route.status === 'available' ? route.estimatedCostCents : null,
      reason: route.status === 'unavailable' ? route.reason : null,
      updated_at: route.updatedAt,
    }).onConflict(oc => oc.constraint('route_plans_trip_owner_key_uq').doUpdateSet({
      status: route.status, origin_json: JSON.stringify(route.origin), destination_json: JSON.stringify(route.destination),
      distance_meters: route.status === 'available' ? route.distanceMeters : null,
      duration_minutes: route.status === 'available' ? route.durationMinutes : null,
      polyline: route.status === 'available' ? route.polyline : null,
      estimated_cost_cents: route.status === 'available' ? route.estimatedCostCents : null,
      reason: route.status === 'unavailable' ? route.reason : null, updated_at: route.updatedAt,
    })).execute();
  }

  async upsertRoute(tripId: string, ownerId: string, route: RoutePlan, tx?: DatabaseTransaction): Promise<void> {
    return this.saveRoute(tripId, ownerId, route, tx);
  }

  async getRoute(tripId: string, ownerId: string, originPlaceId: string, destinationPlaceId: string, mode: RouteMode): Promise<RoutePlan | undefined> {
    const row = await this.db.selectFrom('route_plans').selectAll()
      .where('trip_id', '=', tripId).where('owner_id', '=', ownerId)
      .where('origin_place_id', '=', originPlaceId).where('destination_place_id', '=', destinationPlaceId).where('mode', '=', mode)
      .executeTakeFirst();
    if (!row) return undefined;
    const base = {
      originPlaceId: row.origin_place_id, destinationPlaceId: row.destination_place_id, mode: row.mode,
      origin: JSON.parse(row.origin_json), destination: JSON.parse(row.destination_json), provider: 'amap' as const,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
    return RoutePlanSchema.parse(row.status === 'available'
      ? { ...base, status: 'available', distanceMeters: row.distance_meters, durationMinutes: row.duration_minutes, polyline: row.polyline, estimatedCostCents: row.estimated_cost_cents }
      : { ...base, status: 'unavailable', reason: row.reason });
  }

  private async assertTripOwner(tripId: string, ownerId: string, tx?: DatabaseTransaction): Promise<void> {
    const trip = await (tx ?? this.db).selectFrom('trips').select('owner_id').where('id', '=', tripId).executeTakeFirst();
    if (!trip || trip.owner_id !== ownerId) throw new Error('trip does not belong to owner');
  }
}

export { MapRepository as PostgresMapRepository };
