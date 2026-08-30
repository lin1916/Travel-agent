import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';

describe('booking API boundaries', () => {
  let app: INestApplication;
  beforeAll(async () => { process.env.NODE_ENV = 'test'; const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(new FastifyAdapter()); app.useGlobalFilters(new ApplicationErrorFilter()); await app.init(); await app.getHttpAdapter().getInstance().ready(); });
  afterAll(async () => app.close());

  it('rejects traveler plaintext and unknown create fields', async () => {
    const response = await request(app.getHttpServer()).post('/v1/trips/t-1/booking-intents').set('x-actor-id', 'actor-1').send({ id: 'i-1', offerId: 'o-1', offerKind: 'train', supplierId: 's-1', selectedOfferSnapshotHash: 'h-1', originalPriceCents: 1000, refundRulesHash: 'r-1', travelerDataGrantId: 'g-1', passportNumber: 'secret' });
    expect(response.status).toBe(400);
  });

  it('requires authorization and exposes order status', async () => {
    const created = await request(app.getHttpServer()).post('/v1/trips/t-2/booking-intents').set('x-actor-id', 'actor-1').send({ id: 'i-2', offerId: 'o-2', offerKind: 'train', supplierId: 's-1', selectedOfferSnapshotHash: 'offer-v1', originalPriceCents: 1000, refundRulesHash: 'rules-v1', travelerDataGrantId: 'g-1' });
    expect(created.status).toBe(201);
    const denied = await request(app.getHttpServer()).post('/v1/booking-intents/i-2/commit').set('x-actor-id', 'actor-1').send({ expectedVersion: 1, idempotencyKey: 'k-1', selectedOfferSnapshotHash: 'offer-v1' });
    expect(denied.status).toBe(422);
    const committed = await request(app.getHttpServer()).post('/v1/booking-intents/i-2/commit').set('x-actor-id', 'actor-1').send({ expectedVersion: 1, actionRequestId: 'test-approved', idempotencyKey: 'k-2', selectedOfferSnapshotHash: 'offer-v1' });
    expect(committed.status).toBe(202);
    const order = await request(app.getHttpServer()).get('/v1/supplier-orders/mock-order-001').set('x-actor-id', 'actor-1');
    expect(order.status).toBe(200);
    const forbidden = await request(app.getHttpServer()).get('/v1/supplier-orders/mock-order-001').set('x-actor-id', 'actor-2');
    expect(forbidden.status).toBe(403);
  });
});
