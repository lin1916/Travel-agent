import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import { TRIP_SERVICE } from '../src/modules/trips/trip.providers.js';
import type { TripService } from '@travel/application';

describe('agent planning API', () => {
  let app: INestApplication;
  let anonymousTripId: string;
  let ownerTripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.TRAVEL_AGENT_TEST_PROVIDER = 'rule';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const trips = app.get<TripService>(TRIP_SERVICE);
    const ownerTrip = await trips.create('run-owner', {
      destination: '杭州',
      startsAt: '2026-09-01T00:00:00.000+08:00',
      endsAt: '2026-09-03T00:00:00.000+08:00',
      travelerCount: 2,
    }, { idempotencyKey: 'agent-owner-trip', totalBudgetCents: 0 });
    const anonymousTrip = await trips.create('anonymous-owner', {
      destination: '杭州',
      startsAt: '2026-09-01T00:00:00.000+08:00',
      endsAt: '2026-09-03T00:00:00.000+08:00',
      travelerCount: 2,
    }, { idempotencyKey: 'agent-anonymous-trip', totalBudgetCents: 0 });
    ownerTripId = ownerTrip.id;
    anonymousTripId = anonymousTrip.id;
  });

  afterAll(async () => app.close());

  it('allows anonymous planning and returns a resumable run summary', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/agent/runs')
      .send({ tripId: anonymousTripId, userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03 for 2 travelers' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ tripId: anonymousTripId, status: 'completed' });
    expect(response.body.toolCallSummaries).toHaveLength(4);
    expect(response.body).not.toHaveProperty('chainOfThought');

    const fetched = await request(app.getHttpServer()).get(`/v1/agent/runs/${response.body.runId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.runId).toBe(response.body.runId);
  });

  it('rejects commit capability without an authenticated actor', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/agent/runs')
      .send({ tripId: 'trip-anonymous', userMessage: 'Book the cheapest option', risk: 'commit' });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'policy_blocked' });
  });

  it('returns a controlled validation error for an unknown trip', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/agent/runs')
      .send({ tripId: 'missing-trip', userMessage: 'Plan Hangzhou' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_error' });
  });

  it('enforces run ownership on read and resume', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/agent/runs')
      .set('x-actor-id', 'run-owner')
      .send({ tripId: ownerTripId, userMessage: 'Plan Hangzhou' });
    expect(created.status).toBe(201);
    const runId = created.body.runId;
    const read = await request(app.getHttpServer()).get(`/v1/agent/runs/${runId}`).set('x-actor-id', 'other-actor');
    expect(read.status).toBe(403);
    const resumed = await request(app.getHttpServer()).post(`/v1/agent/runs/${runId}/resume`).set('x-actor-id', 'other-actor').send({ userMessage: '2026-09-01 to 2026-09-03' });
    expect(resumed.status).toBe(403);
  });
});
