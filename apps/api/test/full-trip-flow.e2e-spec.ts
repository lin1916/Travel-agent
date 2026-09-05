import { describe, expect, it } from 'vitest';
import { faultModes, runFullTripScenario } from '@travel/testkit';
import { scanSensitiveOutput } from '@travel/security';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import { TripModule } from '../src/modules/trips/trip.module.js';
import { SearchModule } from '../src/modules/search/search.module.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { TravelerModule, TRAVELER_VAULT_CLIENT, type TravelerVaultClient } from '../src/modules/travelers/traveler.module.js';

class FullFlowVaultClient implements TravelerVaultClient {
  async storeFields(_actorId: string, input: Parameters<TravelerVaultClient['storeFields']>[1]) { return { travelerId: input.travelerId, fieldNames: Object.keys(input.fields), retentionUntil: input.retentionUntil }; }
  async deleteField() { return { deleted: true }; }
  async issueGrant(_actorId: string, input: Parameters<TravelerVaultClient['issueGrant']>[1]) { return { id: 'grant-full-flow-001', intentId: input.intentId, expiresAt: input.expiresAt }; }
  async revokeGrant() { return { revoked: true }; }
}

@Controller('/fixture')
class FixtureController {
  @Get('/full-trip')
  get() { return runFullTripScenario({ now: '2026-09-01T00:00:00.000+08:00' }); }
}

describe('full trip API fixture', () => {
  it('executes the production trip/search workflow boundary', async () => {
    process.env.NODE_ENV = 'test';
    const module = await Test.createTestingModule({ imports: [TripModule, SearchModule] }).compile();
    const app: INestApplication = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const created = await request(app.getHttpServer()).post('/v1/trips').set('x-actor-id', 'actor-demo-001').set('idempotency-key', 'trip-demo-001').send({ destination: '杭州', startsAt: '2026-09-01T00:00:00.000+08:00', endsAt: '2026-09-03T00:00:00.000+08:00', travelerCount: 2, totalBudgetCents: 20_000 });
    expect(created.status).toBe(201);
    const tripId = created.body.id as string;
    const search = await request(app.getHttpServer()).post(`/v1/trips/${tripId}/searches`).set('x-actor-id', 'actor-demo-001').send({ kinds: ['train', 'stay', 'attraction', 'dining'], travelers: 2 });
    expect([201, 202]).toContain(search.status);
    expect(search.body.status).toBe('queued');
    const fetched = await request(app.getHttpServer()).get(`/v1/trips/${tripId}`).set('x-actor-id', 'actor-demo-001');
    expect(fetched.status).toBe(200);
    expect(fetched.body.destination).toBe('杭州');
    await app.close();
  });

  it('requires login, accepts six traveler references, rejects a seventh, and issues a bound grant', async () => {
    process.env.NODE_ENV = 'test'; process.env.DEV_IDENTITY_CODE = 'full-flow-code'; process.env.DEV_IDENTITY_ACTOR_ID = 'actor-demo-001';
    const module = await Test.createTestingModule({ imports: [AuthModule, TravelerModule] }).overrideProvider(TRAVELER_VAULT_CLIENT).useValue(new FullFlowVaultClient()).compile();
    const app: INestApplication = module.createNestApplication(new FastifyAdapter()); await app.init(); await app.getHttpAdapter().getInstance().ready();
    expect((await request(app.getHttpServer()).post('/v1/travelers').send({})).status).toBe(401);
    const login = await request(app.getHttpServer()).post('/v1/auth/dev-login').send({ developmentCode: 'full-flow-code' });
    const token = login.body.sessionId as string;
    const travelerIds = Array.from({ length: 7 }, (_, index) => `traveler-${String(index + 1).padStart(15, '0')}a`);
    for (const travelerId of travelerIds.slice(0, 6)) {
      const response = await request(app.getHttpServer()).post('/v1/travelers').set('authorization', `Bearer ${token}`).send({ travelerId, retentionUntil: '2026-09-30T00:00:00.000Z', fields: { fullName: 'Private Traveler Value' } });
      expect(response.status, travelerId).toBe(201); expect(response.text).not.toContain('Private Traveler Value');
    }
    const seventh = await request(app.getHttpServer()).post('/v1/travelers').set('authorization', `Bearer ${token}`).send({ travelerId: travelerIds[6], retentionUntil: '2026-09-30T00:00:00.000Z', fields: { fullName: 'Seventh Traveler' } });
    expect(seventh.status).toBe(403);
    const grant = await request(app.getHttpServer()).post('/v1/traveler-data-grants').set('authorization', `Bearer ${token}`).send({ intentId: 'intent-demo-001', intentVersion: 1, supplierLegalEntity: 'mock-train', travelerIds: travelerIds.slice(0, 6), allowedFields: ['fullName'], purpose: 'ticketing', offerSnapshotHash: 'offer-v1', authorizationRef: 'action-demo-001', expiresAt: '2026-09-02T15:30:00.000Z' });
    expect(grant.status).toBe(201); expect(grant.body.id).toBe('grant-full-flow-001');
    await app.close(); delete process.env.DEV_IDENTITY_CODE; delete process.env.DEV_IDENTITY_ACTOR_ID;
  });

  it('serves the workflow through an HTTP boundary', async () => {
    const module = await Test.createTestingModule({ controllers: [FixtureController] }).compile();
    const app: INestApplication = module.createNestApplication(new FastifyAdapter());
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const response = await request(app.getHttpServer()).get('/fixture/full-trip');
    expect(response.status).toBe(200);
    expect(response.body.workflow).toContain('api_order_committed');
    expect(response.body.auth.bookingRequiresLogin).toBe(true);
    expect(response.body.travelerLimit.rejectedAt).toBe(7);
    expect(response.body.unknownOrder.reconciliationStatus).toBe('pending');
    await app.close();
  });

  it('exposes the complete mock workflow state for API consumers', () => {
    const result = runFullTripScenario({ now: '2026-09-01T00:00:00.000+08:00' });
    expect(result.trip.id).toBe('trip-demo-001');
    expect(result.search.categories).toHaveLength(4);
    expect(result.apiOrder.status).toBe('confirmed');
    expect(result.redirectOrder.status).toBe('confirmed');
    expect(result.callbacks.accepted).toBe(2);
    expect(result.unknownOrder.reconciliationStatus).toBe('pending');
    expect(result.itinerary.confirmedItems.map(item => item.id)).toEqual(['item-train-001', 'item-stay-001']);
  });

  it('keeps every documented fault mode deterministic and non-leaking', () => {
    for (const fault of faultModes) expect(scanSensitiveOutput(JSON.stringify(runFullTripScenario({ fault })))).toEqual([]);
  });
});
