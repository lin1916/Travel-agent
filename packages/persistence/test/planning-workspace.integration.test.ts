import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../src/db.js';
import { migrateToLatest } from '../src/migrations/runner.js';
import { ConversationRepository } from '../src/repositories/conversation-repository.js';
import { MapRepository } from '../src/repositories/map-repository.js';
import { PlanRepository } from '../src/repositories/plan-repository.js';
import type { Conversation, Place, PlanVersion, RoutePlan } from '@travel/contracts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('planning workspace PostgreSQL persistence', () => {
  it('reports the DATABASE_URL gate when PostgreSQL is not configured', () => {
    if (!hasDatabase) expect('DATABASE_URL missing; PostgreSQL integration skipped').toContain('DATABASE_URL missing');
  });

  const integration = hasDatabase ? it : it.skip;
  let db: ReturnType<typeof createDatabase>;
  let conversations: ConversationRepository;
  let plans: PlanRepository;
  let maps: MapRepository;

  beforeAll(async () => {
    if (!hasDatabase) return;
    db = createDatabase();
    await migrateToLatest(db);
    conversations = new ConversationRepository(db);
    plans = new PlanRepository(db);
    maps = new MapRepository(db);
  });

  afterAll(async () => {
    if (db) await closeDatabase(db);
  });

  integration('preserves ownership, message order, immutable plan versions and normalized map data', async () => {
    const now = '2026-09-03T00:00:00.000Z';
    const conversation: Conversation & { sessionId: string } = {
      id: `conversation-${Date.now()}`,
      sessionId: `session-${Date.now()}`,
      providerName: 'test-provider',
      model: 'test-model',
      status: 'active',
      messages: [
        { id: 'message-1', role: 'user', content: 'Plan Hangzhou', createdAt: now },
        { id: 'message-2', role: 'assistant', content: 'Planning started', createdAt: now },
      ],
      createdAt: now,
      updatedAt: now,
      expiresAt: '2026-09-10T00:00:00.000Z',
    };
    await conversations.create(conversation);
    await expect(conversations.getForSession(conversation.sessionId, conversation.id)).resolves.toMatchObject({
      id: conversation.id,
      messages: [{ id: 'message-1' }, { id: 'message-2' }],
    });
    await expect(conversations.getForSession('other-session', conversation.id)).resolves.toBeUndefined();

    const version = {
      id: `plan-${Date.now()}`,
      tripId: `trip-${Date.now()}`,
      version: 1,
      createdAt: now,
      items: [],
      warnings: [],
      budget: {
        limit: { amountCents: 500_000, currency: 'CNY' },
        estimatedTotal: { amountCents: 0, currency: 'CNY' },
        groupTotal: { amountCents: 0, currency: 'CNY' },
        perPerson: { amountCents: 0, currency: 'CNY' },
        byCategory: {},
        utilizationPercent: 0,
        warnings: [],
      },
      changeSet: { command: 'calculate', summary: 'Initialized', changedItemIds: [] },
    } satisfies PlanVersion;
    await db.insertInto('trips').values({
      id: version.tripId,
      owner_id: conversation.sessionId,
      version: 1,
      destination: 'Hangzhou',
      starts_at: now,
      ends_at: '2026-09-04T00:00:00.000Z',
      traveler_count: 2,
      created_at: now,
      updated_at: now,
    }).execute();
    await plans.append(version, conversation.sessionId);
    await expect(plans.current(version.tripId, conversation.sessionId)).resolves.toMatchObject({ version: 1 });
    await expect(plans.append({ ...version, id: `${version.id}-duplicate` }, conversation.sessionId)).rejects.toThrow();

    const place: Place = {
      id: 'place-1',
      name: 'West Lake',
      category: 'attraction',
      address: 'Hangzhou',
      city: 'Hangzhou',
      latitude: 30.244,
      longitude: 120.149,
      location: { latitude: 30.244, longitude: 120.149, coordinateSystem: 'GCJ-02' },
      coordinateSystem: 'gcj02',
      provider: 'amap',
      providerPlaceId: 'B000A1B2C3',
      sourceUpdatedAt: now,
    };
    const route: RoutePlan = {
      originPlaceId: place.id,
      destinationPlaceId: place.id,
      mode: 'walk',
      origin: place.location,
      destination: place.location,
      provider: 'amap',
      updatedAt: now,
      status: 'available',
      distanceMeters: 0,
      durationMinutes: 0,
      polyline: null,
      estimatedCostCents: null,
    };
    await maps.savePlace(version.tripId, conversation.sessionId, place);
    await maps.saveRoute(version.tripId, conversation.sessionId, route);
    await expect(maps.listPlaces(version.tripId, conversation.sessionId)).resolves.toHaveLength(1);
    await expect(maps.getRoute(version.tripId, conversation.sessionId, route.originPlaceId, route.destinationPlaceId, route.mode)).resolves.toMatchObject({ provider: 'amap' });
  });
});
