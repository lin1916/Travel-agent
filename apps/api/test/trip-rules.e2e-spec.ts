import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';

describe('trip rules API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it('creates and reads a trip for its owner', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/trips')
      .set('x-actor-id', 'owner-1')
      .send({
        destination: '杭州',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-03T00:00:00.000Z',
        travelerCount: 2,
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ownerId: 'owner-1', destination: '杭州', version: 1 });

    const read = await request(app.getHttpServer())
      .get('/v1/trips/' + created.body.id)
      .set('x-actor-id', 'owner-1');
    expect(read.status).toBe(200);

    const forbidden = await request(app.getHttpServer())
      .get('/v1/trips/' + created.body.id)
      .set('x-actor-id', 'owner-2');
    expect(forbidden.status).toBe(403);
  });

  it('returns empty itinerary and initialized budget projections', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/trips')
      .set('x-actor-id', 'owner-3')
      .send({
        destination: '苏州',
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-10-02T00:00:00.000Z',
        travelerCount: 1,
        totalBudgetCents: 100_000,
      });
    const itinerary = await request(app.getHttpServer())
      .get('/v1/trips/' + created.body.id + '/itinerary')
      .set('x-actor-id', 'owner-3');
    const budget = await request(app.getHttpServer())
      .get('/v1/trips/' + created.body.id + '/budget')
      .set('x-actor-id', 'owner-3');
    expect(itinerary.body).toEqual([]);
    expect(budget.body.totalLimit).toEqual({ amountCents: 100_000, currency: 'CNY' });
  });

  it('rejects invalid traveler counts and negative budgets', async () => {
    const invalidTravelers = await request(app.getHttpServer())
      .post('/v1/trips')
      .set('x-actor-id', 'owner-4')
      .send({
        destination: '杭州',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-03T00:00:00.000Z',
        travelerCount: 7,
      });
    expect(invalidTravelers.status).toBe(400);

    const invalidBudget = await request(app.getHttpServer())
      .post('/v1/trips')
      .set('x-actor-id', 'owner-4')
      .send({
        destination: '杭州',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-03T00:00:00.000Z',
        travelerCount: 2,
        totalBudgetCents: -1,
      });
    expect(invalidBudget.status).toBe(400);
  });
});
