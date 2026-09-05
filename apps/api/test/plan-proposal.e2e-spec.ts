import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PlanProposalService, PlanningContextService } from '@travel/application';
import type { PlanProposalDraft } from '@travel/contracts';
import { LocalPlanningAppModule } from '../src/local-planning-app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';

const firstPlace = {
  id: 'place-1', name: '西湖', category: '景点', address: '浙江省杭州市西湖区', city: '杭州', latitude: 30.244, longitude: 120.149,
  location: { latitude: 30.244, longitude: 120.149, coordinateSystem: 'GCJ-02' }, coordinateSystem: 'gcj02' as const,
  provider: 'amap' as const, providerPlaceId: 'B000A1B2C3', sourceUpdatedAt: '2026-09-04T00:00:00.000Z',
};

function draft(conversationId: string): PlanProposalDraft {
  return {
    conversationId, tripId: 'trip-1', planningContextVersion: 2, proposedPlaces: [firstPlace],
    itinerary: [{ category: 'attraction', title: '西湖', startsAt: '2026-10-01T09:00:00.000+08:00', endsAt: '2026-10-01T11:00:00.000+08:00', location: { city: '杭州' }, estimatedCostCents: 40_000 }],
    budgetSummary: {
      limit: { amountCents: 500_000, currency: 'CNY' }, estimatedTotal: { amountCents: 40_000, currency: 'CNY' }, groupTotal: { amountCents: 40_000, currency: 'CNY' }, perPerson: { amountCents: 20_000, currency: 'CNY' }, byCategory: { attraction: { amountCents: 40_000, currency: 'CNY' } }, utilizationPercent: 8, warnings: [],
    },
    warnings: [], expiresAt: '2026-12-01T00:00:00.000Z',
  };
}

describe('conversation-scoped plan proposal APIs', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [LocalPlanningAppModule] }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => { await app?.close(); });

  it('returns current pending proposals, accepts places and rejects stale or expired proposal operations', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({ tripId: 'trip-1' }).expect(201);
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const sessionId = cookie.split('=')[1];
    const contexts = app.get(PlanningContextService);
    await contexts.applyPatch(sessionId, created.body.id, {
      destination: '杭州', startsAt: '2026-10-01T00:00:00.000+08:00', endsAt: '2026-10-04T00:00:00.000+08:00', travelerCount: 2, totalBudgetCents: 500_000,
    }, 1);
    const proposals = app.get(PlanProposalService);
    const proposal = await proposals.create(sessionId, draft(created.body.id));

    await request(app.getHttpServer()).get(`/v1/conversations/${created.body.id}/candidates`).set('Cookie', cookie).expect(200).expect({ candidates: [] });
    await request(app.getHttpServer())
      .get(`/v1/conversations/${created.body.id}/plan-proposals/current`)
      .set('Cookie', cookie)
      .expect(200)
      .expect(proposal);

    const acceptedPlace = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/plan-proposals/${proposal.id}/places/${firstPlace.id}/accept`)
      .set('Cookie', cookie)
      .send({ expectedProposalVersion: proposal.version })
      .expect(201);
    expect(acceptedPlace.body).toMatchObject({ place: firstPlace, source: 'accepted_agent_proposal' });

    const current = await request(app.getHttpServer()).get(`/v1/conversations/${created.body.id}/plan-proposals/current`).set('Cookie', cookie).expect(200);
    const input = { expectedProposalVersion: current.body.version, expectedPlanningContextVersion: 2, expectedPlanVersion: 1 };
    await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/plan-proposals/${proposal.id}/accept`)
      .set('Cookie', cookie)
      .send(input)
      .expect(400);
    const accepted = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/plan-proposals/${proposal.id}/accept`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'accept-once')
      .send(input)
      .expect(200);
    expect(accepted.body).toMatchObject({ proposal: { status: 'accepted' }, planVersion: { version: 2 } });
    await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/plan-proposals/${proposal.id}/accept`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'accept-once')
      .send(input)
      .expect(200)
      .expect(accepted.body);

    const replacement = await proposals.create(sessionId, draft(created.body.id));
    await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/plan-proposals/${replacement.id}/reject`)
      .set('Cookie', cookie)
      .send({ expectedProposalVersion: replacement.version + 1 })
      .expect(409);
    const rejected = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/plan-proposals/${replacement.id}/reject`)
      .set('Cookie', cookie)
      .send({ expectedProposalVersion: replacement.version })
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected' });

    const expired = await proposals.create(sessionId, draft(created.body.id));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(expired.expiresAt));
    try {
      await request(app.getHttpServer())
        .post(`/v1/conversations/${created.body.id}/plan-proposals/${expired.id}/reject`)
        .set('Cookie', cookie)
        .send({ expectedProposalVersion: expired.version })
        .expect(410);
    } finally { vi.useRealTimers(); }
  });
});
