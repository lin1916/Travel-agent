import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CandidateService, ConversationPlanningCoordinator, PlanService } from '@travel/application';
import { LocalPlanningAppModule } from '../src/local-planning-app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';

describe('conversation plan undo', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [LocalPlanningAppModule] }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app?.close(); });

  it('undoes an accepted plan with cookie ownership and version checks, retaining candidates', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const sessionId = cookie.split('=')[1];
    let conversationId = created.body.id;
    const scope = await app.get(ConversationPlanningCoordinator).applyAndEnsureTrip({
      sessionId, conversationId, expectedContextVersion: 1,
      patch: { destination: '杭州', startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00', travelerCount: 2, totalBudgetCents: 500_000 },
    });
    const linked = await request(app.getHttpServer()).post('/v1/conversations').set('Cookie', cookie).send({ tripId: scope.trip!.id }).expect(201);
    conversationId = linked.body.id;
    const candidates = app.get(CandidateService);
    const saved = await candidates.add(sessionId, conversationId, { source: 'user_search', place: {
      id: 'west-lake', name: 'West Lake', category: 'attraction', address: 'Hangzhou', city: 'Hangzhou',
      latitude: 30.244, longitude: 120.149, location: { latitude: 30.244, longitude: 120.149, coordinateSystem: 'GCJ-02' },
      coordinateSystem: 'gcj02', provider: 'amap', providerPlaceId: 'west-lake', sourceUpdatedAt: '2026-09-05T00:00:00Z',
    } });
    await app.get(PlanService).acceptProposal(scope.trip!.id, sessionId, [{
      category: 'attraction', title: 'West Lake', startsAt: '2026-10-02T09:00:00+08:00', endsAt: '2026-10-02T11:00:00+08:00',
      location: { city: 'Hangzhou' }, estimatedCostCents: 0,
    }], 1, { travelerCount: 2, totalBudgetCents: 500_000 });
    const path = `/v1/conversations/${conversationId}/plan/undo`;
    const other = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    await request(app.getHttpServer()).post(path).set('Cookie', other.headers['set-cookie'][0].split(';')[0]).send({ expectedVersion: 2 }).expect(403);
    await request(app.getHttpServer()).post(path).set('Cookie', cookie).send({ expectedVersion: 0 }).expect(400);
    const undone = await request(app.getHttpServer()).post(path).set('Cookie', cookie).send({ expectedVersion: 2 }).expect(200);
    expect(undone.body).toMatchObject({ version: 3, items: [], changeSet: { command: 'undo' } });
    await request(app.getHttpServer()).post(path).set('Cookie', cookie).send({ expectedVersion: 2 }).expect(409);
    expect(await candidates.list(sessionId, conversationId)).toEqual([saved]);
  });
});
