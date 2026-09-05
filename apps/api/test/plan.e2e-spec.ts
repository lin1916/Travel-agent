import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { ApplicationError, PlanService } from '@travel/application';
import { PlanController } from '../src/modules/plans/plan.controller.js';
import { PlanModule, PLAN_EVENT_PUBLISHER, PostgresPlanEventPublisher } from '../src/modules/plans/plan.module.js';
import { InMemoryPlanEventPublisher } from '@travel/application';
import { TRIP_SERVICE, BUDGET_SERVICE } from '../src/modules/trips/trip.providers.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';

describe('versioned planning API', () => {
  it('adapts plan events to the durable event repository boundary', async () => {
    const appended: Array<Record<string, unknown>> = [];
    const publisher = new PostgresPlanEventPublisher({
      append: async event => {
        appended.push(event as unknown as Record<string, unknown>);
        return { ...event, sequence: 3 };
      },
    } as never);

    await publisher.publish({
      event_id: 'plan-event-1', event_type: 'PlanVersionCreated', aggregate_type: 'Trip', aggregate_id: 'trip-1',
      schema_version: 1, occurred_at: '2026-09-02T00:00:00.000Z', request_id: 'plan-event-1', correlation_id: 'corr-1',
      redacted_payload: { version: 2, command: 'add' }, tripId: 'trip-1',
    });

    expect(appended[0]).toMatchObject({ tripId: 'trip-1', aggregate_id: 'trip-1' });
    expect(appended[0]).not.toHaveProperty('sequence');
  });

  it('wires one plan service with a redacted lifecycle publisher', async () => {
    const module = await Test.createTestingModule({ imports: [PlanModule] }).compile();
    const plans = module.get(PlanService);
    const publisher = module.get<InMemoryPlanEventPublisher>(PLAN_EVENT_PUBLISHER);

    const empty = await plans.current('trip-1', 'owner-1');
    await plans.execute('trip-1', 'owner-1', { kind: 'add', item: {
      category: 'attraction', title: '西湖', startsAt: '2026-10-01T09:00:00.000+08:00', endsAt: '2026-10-01T11:00:00.000+08:00', location: { city: '杭州' },
    } }, empty.version);

    expect(module.get(PlanService)).toBe(plans);
    expect(publisher.events).toHaveLength(2);
    expect(JSON.stringify(publisher.events[1])).not.toContain('西湖');
    expect(JSON.stringify(publisher.events[1])).not.toContain('杭州');
  });

  it('enforces ownership and optimistic versions while exposing undo', async () => {
    const module = await Test.createTestingModule({
      controllers: [PlanController],
      providers: [
        PlanService,
        { provide: TRIP_SERVICE, useValue: { get: async (_id: string, owner: string) => { if (owner !== 'owner-1') throw new ApplicationError('forbidden'); return { travelerCount: 2 }; } } },
        { provide: BUDGET_SERVICE, useValue: { get: async () => ({ totalLimit: { amountCents: 500_000, currency: 'CNY' } }) } },
      ],
    }).compile();
    const app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const empty = await request(app.getHttpServer()).get('/v1/trips/trip-1/plans/current').set('x-actor-id', 'owner-1').expect(200);
    expect(empty.body.version).toBe(1);
    const added = await request(app.getHttpServer()).post('/v1/trips/trip-1/plans/commands').set('x-actor-id', 'owner-1').send({ expectedVersion: 1, command: {
      kind: 'add', item: { category: 'attraction', title: '西湖', startsAt: '2026-10-01T09:00:00.000+08:00', endsAt: '2026-10-01T11:00:00.000+08:00', location: { city: '杭州' }, estimatedCostCents: 1000 },
    } }).expect(200);
    expect(added.body.version).toBe(2);
    await request(app.getHttpServer()).post('/v1/trips/trip-1/plans/commands').set('x-actor-id', 'owner-1').send({ expectedVersion: 1, command: { kind: 'calculate' } }).expect(409);
    await request(app.getHttpServer()).get('/v1/trips/trip-1/plans/current').set('x-actor-id', 'other').expect(403);
    const undone = await request(app.getHttpServer()).post('/v1/trips/trip-1/plans/undo').set('x-actor-id', 'owner-1').send({ expectedVersion: 2 }).expect(200);
    expect(undone.body.items).toEqual([]);
    expect(undone.body.version).toBe(3);
    await app.close();
  });
});
