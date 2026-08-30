import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';

describe('search API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it('searches a trip for its owner and returns category source timestamps', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/trips')
      .set('x-actor-id', 'search-owner')
      .set('idempotency-key', 'search-trip-1')
      .send({ destination: '杭州', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-03T00:00:00.000Z', travelerCount: 2 });
    expect(created.status).toBe(201);

    const response = await request(app.getHttpServer())
      .post(`/v1/trips/${created.body.id}/searches`)
      .set('x-actor-id', 'search-owner')
      .send({ kinds: ['train', 'stay'], startsAt: created.body.startsAt, endsAt: created.body.endsAt, travelers: 2 });

    expect(response.status).toBe(201);
    expect(response.body.offers.train.length).toBeGreaterThan(0);
    expect(response.body.categories.train.source).toMatch(/^mock-/);
  });

  it('enforces trip ownership for search', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/trips')
      .set('x-actor-id', 'search-owner-2')
      .set('idempotency-key', 'search-trip-2')
      .send({ destination: '杭州', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-03T00:00:00.000Z', travelerCount: 2 });
    const response = await request(app.getHttpServer())
      .post(`/v1/trips/${created.body.id}/searches`)
      .set('x-actor-id', 'other-owner')
      .send({ kinds: ['train'], travelers: 2 });
    expect(response.status).toBe(403);
  });
});
