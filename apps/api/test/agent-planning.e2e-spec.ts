import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';

describe('agent planning API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it('allows anonymous planning and returns a resumable run summary', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/agent/runs')
      .send({ tripId: 'trip-anonymous', userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03 for 2 travelers' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ tripId: 'trip-anonymous', status: 'completed' });
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

  it('enforces run ownership on read and resume', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/agent/runs')
      .set('x-actor-id', 'run-owner')
      .send({ tripId: 'trip-owner', userMessage: 'Plan Hangzhou' });
    expect(created.status).toBe(201);
    const runId = created.body.runId;
    const read = await request(app.getHttpServer()).get(`/v1/agent/runs/${runId}`).set('x-actor-id', 'other-actor');
    expect(read.status).toBe(403);
    const resumed = await request(app.getHttpServer()).post(`/v1/agent/runs/${runId}/resume`).set('x-actor-id', 'other-actor').send({ userMessage: '2026-09-01 to 2026-09-03' });
    expect(resumed.status).toBe(403);
  });
});
