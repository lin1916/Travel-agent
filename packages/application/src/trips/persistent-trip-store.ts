import { randomUUID } from 'node:crypto';
import type { TripRecord } from '@travel/contracts';
import { withTransaction, type Database, type BudgetRepository, type EventRepository, type IdempotencyRepository, type TripRepository } from '@travel/persistence';
import type { Kysely } from 'kysely';
import { createTripIdempotencyRequest, type CreateTripCommand, type TripStore } from './trip-service.js';
import { ApplicationError } from '../errors.js';

export interface CreateTripPersistenceOptions {
  totalBudgetCents: number;
  idempotencyKey: string;
  requestId?: string;
}

export class PersistentTripStore implements TripStore {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly trips: TripRepository,
    private readonly budgets: BudgetRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly events: EventRepository,
  ) {}

  async create(trip: TripRecord, options?: CreateTripPersistenceOptions): Promise<TripRecord> {
    if (!options?.idempotencyKey) throw new ApplicationError('validation_error', 'idempotency key is required');
    const scope = `trip:create:${trip.ownerId}`;
    return withTransaction(this.db, async tx => {
      const claim = await this.idempotency.claim(
        scope,
        options.idempotencyKey,
        createTripIdempotencyRequest(trip, options.totalBudgetCents),
        tx,
      );
      if (claim === 'conflict') throw new ApplicationError('conflict', 'idempotency key was reused with a different request');
      if (claim === 'replay') {
        const replay = await this.idempotency.getResponse<TripRecord>(scope, options.idempotencyKey);
        if (replay) return replay;
        throw new ApplicationError('conflict', 'idempotent request is still recovering');
      }
      const created = await this.trips.create(trip, tx);
      await this.budgets.initialize(created.id, options.totalBudgetCents, {}, tx);
      await this.events.appendAndPublishable(tx, {
        event_id: randomUUID(), event_type: 'TripCreated', aggregate_type: 'Trip', aggregate_id: created.id,
        tripId: created.id,
        schema_version: 1, occurred_at: new Date().toISOString(), request_id: options.requestId ?? options.idempotencyKey,
        correlation_id: options.idempotencyKey, redacted_payload: { ownerId: created.ownerId, destination: created.destination, totalBudgetCents: options.totalBudgetCents },
      });
      await this.idempotency.complete(scope, options.idempotencyKey, created, tx);
      return created;
    });
  }

  get(id: string): Promise<TripRecord | null> { return this.trips.get(id); }

  async update(id: string, ownerId: string, expectedVersion: number, patch: Partial<Pick<TripRecord, 'destination' | 'startsAt' | 'endsAt' | 'travelerCount'>>): Promise<TripRecord | null> {
    return withTransaction(this.db, async tx => {
      try {
        const updated = await this.trips.updateVersioned(id, ownerId, expectedVersion, {
          destination: patch.destination, starts_at: patch.startsAt, ends_at: patch.endsAt, traveler_count: patch.travelerCount,
        }, tx);
        await this.events.appendAndPublishable(tx, {
          event_id: randomUUID(), event_type: 'TripUpdated', aggregate_type: 'Trip', aggregate_id: id, schema_version: 1,
          tripId: id,
          occurred_at: new Date().toISOString(), request_id: randomUUID(), correlation_id: id, redacted_payload: { version: updated.version },
        });
        return updated;
      } catch { return null; }
    });
  }
}

export function createTripRecord(ownerId: string, command: CreateTripCommand): TripRecord {
  return { id: randomUUID(), version: 1, ownerId, ...command };
}
