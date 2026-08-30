import { describe, expect, it } from 'vitest';
import { InMemoryTripStore, TripService } from '../src/trips/trip-service.js';
import { PersistentTripStore } from '../src/trips/persistent-trip-store.js';
import { ItineraryService } from '../src/itinerary/itinerary-service.js';

function persistentTestStore() {
  const records = new Map<string, { request: string; response?: any }>();
  const initialized: Array<{ tripId: string; totalBudgetCents: number }> = [];
  const db = {
    transaction: () => ({ execute: async (callback: (tx: unknown) => Promise<unknown>) => callback(db) }),
  } as any;
  const trips = {
    create: async (trip: any) => structuredClone(trip),
  };
  const budgets = {
    initialize: async (tripId: string, totalBudgetCents: number) => {
      initialized.push({ tripId, totalBudgetCents });
    },
  };
  const idempotency = {
    claim: async (scope: string, key: string, request: unknown) => {
      const requestHash = JSON.stringify(request);
      const recordKey = `${scope}:${key}`;
      const existing = records.get(recordKey);
      if (!existing) {
        records.set(recordKey, { request: requestHash });
        return 'claimed';
      }
      return existing.request === requestHash ? 'replay' : 'conflict';
    },
    complete: async (scope: string, key: string, response: unknown) => {
      records.get(`${scope}:${key}`)!.response = structuredClone(response);
    },
    getResponse: async (scope: string, key: string) => records.get(`${scope}:${key}`)?.response ?? null,
  };
  const events = {
    appendAndPublishable: async () => undefined,
  };
  return {
    store: new PersistentTripStore(db, trips as any, budgets as any, idempotency as any, events as any),
    initialized,
  };
}

describe('application rules', () => {
  it('enforces trip ownership and versioning', async () => {
    const service = new TripService(new InMemoryTripStore());
    const trip = await service.create('owner-1', {
      destination: '杭州',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-03T00:00:00.000Z',
      travelerCount: 2,
    }, { idempotencyKey: 'trip-create-1', totalBudgetCents: 0 });
    await expect(service.get(trip.id, 'owner-2')).rejects.toMatchObject({ code: 'forbidden' });
    const updated = await service.update(trip.id, 'owner-1', 1, { destination: '苏州' });
    expect(updated.version).toBe(2);
    await expect(service.update(trip.id, 'owner-1', 1, { destination: '南京' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('replays an idempotent create and rejects a key reused for another request', async () => {
    const service = new TripService(new InMemoryTripStore());
    const command = {
      destination: '杭州', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-03T00:00:00.000Z', travelerCount: 2,
    };
    const first = await service.create('owner-1', command, { idempotencyKey: 'replay-1', totalBudgetCents: 0 });
    const replay = await service.create('owner-1', command, { idempotencyKey: 'replay-1', totalBudgetCents: 0 });
    expect(replay).toEqual(first);
    await expect(service.create('owner-1', { ...command, destination: '苏州' }, { idempotencyKey: 'replay-1', totalBudgetCents: 0 }))
      .rejects.toMatchObject({ code: 'conflict' });
  });

  it('replays persistent creates with the same owner, key, and request', async () => {
    const persistent = persistentTestStore();
    const service = new TripService(persistent.store);
    const command = {
      destination: '杭州', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-03T00:00:00.000Z', travelerCount: 2,
    };

    const first = await service.create('owner-1', command, { idempotencyKey: 'persistent-replay-1', totalBudgetCents: 250_000 });
    const replay = await service.create('owner-1', command, { idempotencyKey: 'persistent-replay-1', totalBudgetCents: 250_000 });

    expect(replay).toEqual(first);
    expect(persistent.initialized).toEqual([{ tripId: first.id, totalBudgetCents: 250_000 }]);
  });

  it('scopes in-memory idempotency keys per owner', async () => {
    const service = new TripService(new InMemoryTripStore());
    const command = {
      destination: '杭州', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-03T00:00:00.000Z', travelerCount: 2,
    };

    const ownerOne = await service.create('owner-1', command, { idempotencyKey: 'shared-key', totalBudgetCents: 0 });
    const ownerTwo = await service.create('owner-2', command, { idempotencyKey: 'shared-key', totalBudgetCents: 0 });

    expect(ownerTwo.ownerId).toBe('owner-2');
    expect(ownerTwo.id).not.toBe(ownerOne.id);
  });

  it('rejects a directly overlapping confirmed itinerary item', () => {
    const service = new ItineraryService();
    service.add({
      id: 'a',
      version: 1,
      tripId: 'trip-1',
      category: 'attraction',
      startsAt: '2026-09-01T01:00:00.000Z',
      endsAt: '2026-09-01T03:00:00.000Z',
      confirmed: true,
    });
    expect(() =>
      service.add({
        id: 'b',
        version: 1,
        tripId: 'trip-1',
        category: 'dining',
        startsAt: '2026-09-01T02:00:00.000Z',
        endsAt: '2026-09-01T04:00:00.000Z',
        confirmed: true,
      }),
    ).toThrow('itinerary item overlaps a confirmed item');
  });
});
