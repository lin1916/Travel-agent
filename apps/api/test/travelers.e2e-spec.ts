import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { TripService } from '@travel/application';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import { AppModule } from '../src/app.module.js';
import { DevIdentityProvider } from '../src/modules/auth/dev-identity-provider.js';
import { TRIP_SERVICE } from '../src/modules/trips/trip.providers.js';
import {
  TRAVELER_VAULT_CLIENT,
  type TravelerVaultClient,
} from '../src/modules/travelers/traveler.module.js';

class ContractVaultClient implements TravelerVaultClient {
  async storeFields(actorId: string, input: Parameters<TravelerVaultClient['storeFields']>[1]) {
    if (actorId !== 'actor-dev') throw new Error('wrong actor');
    if (input.travelerId === 'leak-error') {
      throw new ServiceUnavailableException(`upstream rejected ${input.fields.fullName}`);
    }
    return { travelerId: input.travelerId, fieldNames: Object.keys(input.fields), retentionUntil: input.retentionUntil };
  }

  async deleteField() { return { deleted: true }; }

  async issueGrant(actorId: string, input: Parameters<TravelerVaultClient['issueGrant']>[1]) {
    if (actorId !== 'actor-dev') throw new Error('wrong actor');
    if (input.purpose === 'leak-error') {
      throw new ServiceUnavailableException(`supplier rejected ${input.supplierLegalEntity}`);
    }
    return { id: 'grant-1', intentId: input.intentId, expiresAt: input.expiresAt };
  }

  async revokeGrant() { return { revoked: true }; }
}

describe('development identity provider', () => {
  it('authenticates a configured local code and verifies the issued session', async () => {
    const provider = DevIdentityProvider.fromEnvironment({
      NODE_ENV: 'development', DEV_IDENTITY_CODE: 'local-code', DEV_IDENTITY_ACTOR_ID: 'actor-dev',
    });

    const actor = await provider.authenticate({ developmentCode: 'local-code' });

    expect(actor.actorId).toBe('actor-dev');
    expect(actor.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(provider.verifySession(actor.sessionId)).resolves.toEqual(actor);
    await expect(provider.verifySession('unknown-session')).resolves.toBeNull();
    await expect(provider.authenticate({ developmentCode: 'wrong-code' }))
      .rejects.toThrow('authentication failed');
  });

  it('cannot be enabled in production mode', () => {
    expect(() => DevIdentityProvider.fromEnvironment({
      NODE_ENV: 'production', DEV_IDENTITY_CODE: 'local-code', DEV_IDENTITY_ACTOR_ID: 'actor-dev',
    })).toThrow('development identity provider is disabled in production');
    expect(() => DevIdentityProvider.fromEnvironment({
      NODE_ENV: 'staging', DEV_IDENTITY_CODE: 'local-code', DEV_IDENTITY_ACTOR_ID: 'actor-dev',
    })).toThrow('development identity provider is disabled outside development/test');
  });
});

describe('authenticated traveler and grant API', () => {
  let app: INestApplication;
  let sessionId: string;
  let anonymousTripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DEV_IDENTITY_CODE = 'local-code';
    process.env.DEV_IDENTITY_ACTOR_ID = 'actor-dev';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TRAVELER_VAULT_CLIENT)
      .useValue(new ContractVaultClient())
      .compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const login = await request(app.getHttpServer()).post('/v1/auth/dev-login')
      .send({ developmentCode: 'local-code' });
    sessionId = login.body.sessionId;
    const trips = app.get<TripService>(TRIP_SERVICE);
    const trip = await trips.create('anonymous-owner', {
      destination: '杭州', startsAt: '2026-09-01T00:00:00.000+08:00',
      endsAt: '2026-09-03T00:00:00.000+08:00', travelerCount: 1,
    }, { idempotencyKey: `traveler-anonymous-${Date.now()}`, totalBudgetCents: 0 });
    anonymousTripId = trip.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.DEV_IDENTITY_CODE;
    delete process.env.DEV_IDENTITY_ACTOR_ID;
  });

  it('rejects unauthenticated traveler and grant operations', async () => {
    const traveler = await request(app.getHttpServer()).post('/v1/travelers').send({});
    const grant = await request(app.getHttpServer()).post('/v1/traveler-data-grants').send({});
    expect(traveler.status).toBe(401);
    expect(grant.status).toBe(401);
  });

  it('stores traveler fields through the Vault boundary without returning plaintext', async () => {
    const response = await request(app.getHttpServer()).post('/v1/travelers')
      .set('authorization', `Bearer ${sessionId}`)
      .send({ travelerId: 'traveler-1', retentionUntil: '2026-09-30T00:00:00.000Z',
        fields: { fullName: 'Ada Lovelace', passportNumber: 'P1234567' } });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ travelerId: 'traveler-1',
      fieldNames: ['fullName', 'passportNumber'], retentionUntil: '2026-09-30T00:00:00.000Z' });
    expect(response.text).not.toContain('Ada Lovelace');
    expect(response.text).not.toContain('P1234567');
  });

  it('records deletion metadata after a traveler field is deleted', async () => {
    const response = await request(app.getHttpServer()).delete('/v1/travelers/traveler-1/fields/fullName')
      .set('authorization', `Bearer ${sessionId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: true });
  });

  it('rejects deletion of a traveler reference owned by another actor', async () => {
    const response = await request(app.getHttpServer()).delete('/v1/travelers/not-owned/fields/fullName')
      .set('authorization', 'Bearer ' + sessionId);

    expect(response.status).toBe(403);
  });

  it('issues a bound grant for an authenticated actor', async () => {
    await request(app.getHttpServer()).post('/v1/travelers')
      .set('authorization', `Bearer ${sessionId}`)
      .send({ travelerId: 'grant-traveler-1', retentionUntil: '2026-09-30T00:00:00.000Z',
        fields: { fullName: 'Grant Traveler' } });
    const response = await request(app.getHttpServer()).post('/v1/traveler-data-grants')
      .set('authorization', `Bearer ${sessionId}`)
      .send({ intentId: 'intent-1', intentVersion: 1, supplierLegalEntity: 'Example Air Limited',
        travelerIds: ['grant-traveler-1'], allowedFields: ['fullName'], purpose: 'ticketing',
        offerSnapshotHash: 'sha256:offer', authorizationRef: 'decision-1',
        expiresAt: '2026-08-30T12:04:00.000Z' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: 'grant-1', intentId: 'intent-1', expiresAt: '2026-08-30T12:04:00.000Z' });
  });

  it('rejects grant issuance for an unowned traveler or an unrecorded field', async () => {
    const unowned = await request(app.getHttpServer()).post('/v1/traveler-data-grants')
      .set('authorization', `Bearer ${sessionId}`)
      .send({ intentId: 'intent-unowned', intentVersion: 1, supplierLegalEntity: 'Example Air Limited',
        travelerIds: ['not-owned'], allowedFields: ['fullName'], purpose: 'ticketing',
        offerSnapshotHash: 'sha256:offer', authorizationRef: 'decision-1',
        expiresAt: '2026-08-30T12:04:00.000Z' });
    const missingField = await request(app.getHttpServer()).post('/v1/traveler-data-grants')
      .set('authorization', `Bearer ${sessionId}`)
      .send({ intentId: 'intent-field', intentVersion: 1, supplierLegalEntity: 'Example Air Limited',
        travelerIds: ['grant-traveler-1'], allowedFields: ['passportNumber'], purpose: 'ticketing',
        offerSnapshotHash: 'sha256:offer', authorizationRef: 'decision-1',
        expiresAt: '2026-08-30T12:04:00.000Z' });

    expect(unowned.status).toBe(403);
    expect(missingField.status).toBe(403);
  });

  it('does not expose traveler or supplier text from downstream errors', async () => {
    const traveler = await request(app.getHttpServer()).post('/v1/travelers')
      .set('authorization', `Bearer ${sessionId}`)
      .send({ travelerId: 'leak-error', retentionUntil: '2026-09-30T00:00:00.000Z',
        fields: { fullName: 'Private Traveler Value' } });
    const grant = await request(app.getHttpServer()).post('/v1/traveler-data-grants')
      .set('authorization', `Bearer ${sessionId}`)
      .send({ intentId: 'intent-1', intentVersion: 1, supplierLegalEntity: 'Untrusted Supplier Text',
        travelerIds: ['traveler-1'], allowedFields: ['fullName'], purpose: 'leak-error',
        offerSnapshotHash: 'sha256:offer', authorizationRef: 'decision-1',
        expiresAt: '2026-08-30T12:04:00.000Z' });

    expect(traveler.text).not.toContain('Private Traveler Value');
    expect(grant.text).not.toContain('Untrusted Supplier Text');
  });

  it('keeps anonymous planning accessible', async () => {
    const response = await request(app.getHttpServer()).post('/v1/agent/runs')
      .send({ tripId: anonymousTripId, userMessage: 'Plan Hangzhou' });
    expect(response.status).toBe(201);
  });
});
