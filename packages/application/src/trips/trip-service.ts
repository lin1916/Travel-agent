import type { TripRecord } from '@travel/contracts';
import { validateTrip } from '@travel/domain';
import { ApplicationError } from '../errors.js';

export interface CreateTripCommand {
  destination: string;
  startsAt: string;
  endsAt: string;
  travelerCount: number;
}

export interface CreateTripOptions {
  idempotencyKey: string;
  totalBudgetCents: number;
}

export function createTripIdempotencyRequest(
  trip: Pick<TripRecord, 'ownerId' | 'destination' | 'startsAt' | 'endsAt' | 'travelerCount'>,
  totalBudgetCents: number,
) {
  return {
    ownerId: trip.ownerId,
    destination: trip.destination,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    travelerCount: trip.travelerCount,
    totalBudgetCents,
  };
}

export interface TripStore {
  create(trip: TripRecord, options?: CreateTripOptions): Promise<TripRecord>;
  get(id: string): Promise<TripRecord | null>;
  update(
    id: string,
    ownerId: string,
    expectedVersion: number,
    patch: Partial<Pick<TripRecord, 'destination' | 'startsAt' | 'endsAt' | 'travelerCount'>>,
  ): Promise<TripRecord | null>;
}

export class InMemoryTripStore implements TripStore {
  private readonly trips = new Map<string, TripRecord>();
  private readonly idempotency = new Map<string, { request: string; response: TripRecord }>();

  async create(trip: TripRecord, options?: CreateTripOptions): Promise<TripRecord> {
    if (!options?.idempotencyKey) {
      throw new ApplicationError('validation_error', 'idempotency key is required');
    }
    const request = JSON.stringify(createTripIdempotencyRequest(trip, options.totalBudgetCents));
    const scopedKey = JSON.stringify([trip.ownerId, options.idempotencyKey]);
    const existing = this.idempotency.get(scopedKey);
    if (existing) {
      if (existing.request !== request) {
        throw new ApplicationError('conflict', 'idempotency key was reused with a different request');
      }
      return structuredClone(existing.response);
    }
    this.trips.set(trip.id, structuredClone(trip));
    this.idempotency.set(scopedKey, { request, response: structuredClone(trip) });
    return structuredClone(trip);
  }

  async get(id: string): Promise<TripRecord | null> {
    const trip = this.trips.get(id);
    return trip ? structuredClone(trip) : null;
  }

  async update(
    id: string,
    ownerId: string,
    expectedVersion: number,
    patch: Partial<Pick<TripRecord, 'destination' | 'startsAt' | 'endsAt' | 'travelerCount'>>,
  ): Promise<TripRecord | null> {
    const current = this.trips.get(id);
    if (!current || current.ownerId !== ownerId || current.version !== expectedVersion) {
      return null;
    }
    const updated = { ...current, ...patch, version: current.version + 1 };
    this.trips.set(id, updated);
    return structuredClone(updated);
  }
}

export class TripService {
  constructor(private readonly store: TripStore) {}

  async create(ownerId: string, command: CreateTripCommand, options?: CreateTripOptions): Promise<TripRecord> {
    try {
      validateTrip(command);
    } catch (error) {
      throw new ApplicationError(
        'validation_error',
        error instanceof Error ? error.message : 'trip validation failed',
      );
    }
    return this.store.create({
      id: randomUUID(),
      version: 1,
      ownerId,
      ...command,
    }, options);
  }

  async get(id: string, ownerId: string): Promise<TripRecord> {
    const trip = await this.store.get(id);
    if (!trip) {
      throw new ApplicationError('validation_error', 'trip not found');
    }
    if (trip.ownerId !== ownerId) {
      throw new ApplicationError('forbidden', 'trip belongs to another actor');
    }
    return trip;
  }

  /** Returns the authoritative trip record for internal planning/version checks. */
  async getAny(id: string): Promise<TripRecord | null> {
    return this.store.get(id);
  }

  async update(
    id: string,
    ownerId: string,
    expectedVersion: number,
    patch: Partial<CreateTripCommand>,
  ): Promise<TripRecord> {
    const current = await this.get(id, ownerId);
    try {
      validateTrip({ ...current, ...patch });
    } catch (error) {
      throw new ApplicationError(
        'validation_error',
        error instanceof Error ? error.message : 'trip validation failed',
      );
    }
    const updated = await this.store.update(id, ownerId, expectedVersion, patch);
    if (!updated) {
      throw new ApplicationError('conflict', 'trip version changed');
    }
    return updated;
  }
}
import { randomUUID } from 'node:crypto';
