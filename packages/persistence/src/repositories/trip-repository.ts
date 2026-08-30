import type { Kysely } from 'kysely';
import type { Database, CreateTripInput, TripPatch } from '../types.js';
import { RepositoryConflictError, toTripRecord } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

export class TripRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(input: CreateTripInput, tx?: DatabaseTransaction) {
    const now = new Date().toISOString();
    const row = await (tx ?? this.db)
      .insertInto('trips')
      .values({
        id: input.id,
        owner_id: input.ownerId,
        version: 1,
        destination: input.destination,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        traveler_count: input.travelerCount,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toTripRecord(row);
  }

  async getForOwner(tripId: string, ownerId: string, tx?: DatabaseTransaction) {
    const row = await (tx ?? this.db)
      .selectFrom('trips')
      .selectAll()
      .where('id', '=', tripId)
      .where('owner_id', '=', ownerId)
      .executeTakeFirst();
    return row ? toTripRecord(row) : null;
  }

  async get(tripId: string, tx?: DatabaseTransaction) {
    const row = await (tx ?? this.db).selectFrom('trips').selectAll().where('id', '=', tripId).executeTakeFirst();
    return row ? toTripRecord(row) : null;
  }

  async updateVersioned(
    tripId: string,
    ownerId: string,
    expectedVersion: number,
    patch: Pick<TripPatch, 'destination' | 'starts_at' | 'ends_at' | 'traveler_count'>,
    tx?: DatabaseTransaction,
  ) {
    const row = await (tx ?? this.db)
      .updateTable('trips')
      .set({ ...patch, version: expectedVersion + 1, updated_at: new Date().toISOString() })
      .where('id', '=', tripId)
      .where('owner_id', '=', ownerId)
      .where('version', '=', expectedVersion)
      .returningAll()
      .executeTakeFirst();
    if (!row) {
      throw new RepositoryConflictError();
    }
    return toTripRecord(row);
  }
}
