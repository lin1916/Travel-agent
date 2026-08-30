import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import { ACTION_REQUEST_SERVICE } from '../src/modules/action-requests/action-request.tokens.js';
import { MANDATE_STORE } from '../src/modules/mandates/mandate.tokens.js';
import { BOOKING_GRANT_STORE, type InMemoryBookingGrantStore } from '../src/modules/bookings/booking.module.js';
import { BookingServiceImpl, type ActionRequestService } from '@travel/application';
type MandateStore = { create(ownerId: string, input: any): any };

describe('booking API boundaries', () => {
  let app: INestApplication;
  beforeAll(async () => { process.env.NODE_ENV = 'test'; const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(new FastifyAdapter()); app.useGlobalFilters(new ApplicationErrorFilter()); await app.init(); await app.getHttpAdapter().getInstance().ready(); });
  afterAll(async () => app.close());

  async function authorize(intentId: string, offerId: string, grantId = 'g-1', actionId = `action-${intentId}-${Date.now()}`, tripId = `trip-${intentId}`, intentVersion = 1) {
    const actions = app.get<ActionRequestService>(ACTION_REQUEST_SERVICE);
    const mandates = app.get<MandateStore>(MANDATE_STORE);
    const grants = app.get<InMemoryBookingGrantStore>(BOOKING_GRANT_STORE);
    const mandate = mandates.create('actor-1', {
      id: `mandate-${intentId}-${Date.now()}`, tripId, totalBudgetLimit: { amountCents: 100_000, currency: 'CNY' }, categoryLimits: {},
      allowedBookingTypes: ['train'], allowedSuppliers: ['mock-train'], refundableOnly: true,
      maxSingleOrderAmount: { amountCents: 10_000, currency: 'CNY' }, allowedSensitiveFields: ['fullName'], validUntil: '2026-09-30T00:00:00.000Z', exceptionPolicy: 'none',
    });
    const action = await actions.create('actor-1', { tripId, resourceId: offerId, kind: 'booking', risk: 'commit', requestedAmount: { amountCents: 1000, currency: 'CNY' }, supplierId: 'mock-train', bookingType: 'train', refundable: true, offerSnapshotHash: 'offer-v1', requestedSensitiveFields: ['fullName'] }, { correlationId: `booking-${intentId}` });
    const approved = await actions.decide(action.id, 'actor-1', { approved: true, reason: 'approved', expectedVersion: action.version });
    grants.register({ id: grantId, actorId: 'actor-1', intentId: intentId, intentVersion, supplierLegalEntity: 'mock-train', travelerIds: ['traveler-1'], allowedFields: ['fullName'], purpose: 'ticketing', offerSnapshotHash: 'offer-v1', authorizationRef: approved.id, expiresAt: '2026-09-30T00:00:00.000Z' });
    return { mandate, approved };
  }

  it('rejects traveler plaintext and unknown create fields', async () => {
    const response = await request(app.getHttpServer()).post('/v1/trips/t-1/booking-intents').set('x-actor-id', 'actor-1').send({ id: 'i-1', offerId: 'o-1', offerKind: 'train', supplierId: 's-1', selectedOfferSnapshotHash: 'h-1', originalPriceCents: 1000, refundRulesHash: 'r-1', travelerDataGrantId: 'g-1', passportNumber: 'secret' });
    expect(response.status).toBe(400);
  });

  it('requires authorization and exposes order status', async () => {
    const created = await request(app.getHttpServer()).post('/v1/trips/trip-i-2/booking-intents').set('x-actor-id', 'actor-1').send({ id: 'i-2', offerId: 'o-2', offerKind: 'train', supplierId: 'mock-train', selectedOfferSnapshotHash: 'offer-v1', originalPriceCents: 1000, refundRulesHash: 'rules-v1', travelerDataGrantId: 'g-1', refundable: true, startsAt: '2026-09-10T08:00:00.000+08:00', endsAt: '2026-09-10T10:00:00.000+08:00', travelerIds: ['traveler-1'], requestedSensitiveFields: ['fullName'], travelerDataPurpose: 'ticketing' });
    expect(created.status).toBe(201);
    const authorized = await authorize('i-2', 'o-2');
    const denied = await request(app.getHttpServer()).post('/v1/booking-intents/i-2/commit').set('x-actor-id', 'actor-1').send({ expectedVersion: 1, idempotencyKey: 'k-1', selectedOfferSnapshotHash: 'offer-v1' });
    expect(denied.status).toBe(422);
    (app.get(BookingServiceImpl) as any).orders.setOutcome('accepted');
    const committed = await request(app.getHttpServer()).post('/v1/booking-intents/i-2/commit').set('x-actor-id', 'actor-1').send({ expectedVersion: 1, actionRequestId: authorized.approved.id, mandateId: authorized.mandate.id, idempotencyKey: 'k-2', selectedOfferSnapshotHash: 'offer-v1' });
    expect(committed.status).toBe(202);
    expect(committed.body.supplierOrder.lifecycleStatus).toBe('awaiting_payment');
    const token = new URL(`http://localhost${committed.body.redirectUrl}`).searchParams.get('token');
    expect(token).toBeTruthy();
    const redirect = await request(app.getHttpServer()).get('/v1/supplier-redirects/mock-train').query({ token }).set('x-actor-id', 'actor-1');
    expect(redirect.status).toBe(200);
    expect(redirect.body).toMatchObject({ redirectUrl: 'https://mock.example/pay/mock-order-001', intentId: 'i-2', supplierId: 'mock-train' });
    const order = await request(app.getHttpServer()).get('/v1/supplier-orders/mock-order-001').set('x-actor-id', 'actor-1');
    expect(order.status).toBe(200);
    const forbidden = await request(app.getHttpServer()).get('/v1/supplier-orders/mock-order-001').set('x-actor-id', 'actor-2');
    expect(forbidden.status).toBe(403);
    (app.get(BookingServiceImpl) as any).orders.setOutcome('pending');
  });

  it('maps a supplier rejection to failed without reporting success', async () => {
    const created = await request(app.getHttpServer()).post('/v1/trips/trip-rejected/booking-intents').set('x-actor-id', 'actor-1').send({ id: 'i-rejected', offerId: 'o-rejected', offerKind: 'train', supplierId: 'mock-train', selectedOfferSnapshotHash: 'offer-v1', originalPriceCents: 1000, refundRulesHash: 'rules-v1', travelerDataGrantId: 'g-rejected', refundable: true, travelerIds: ['traveler-1'], requestedSensitiveFields: ['fullName'], travelerDataPurpose: 'ticketing' });
    expect(created.status).toBe(201);
    const auth = await authorize('i-rejected', 'o-rejected', 'g-rejected', undefined, 'trip-rejected');
    (app.get(BookingServiceImpl) as any).orders.setOutcome('rejected');
    const committed = await request(app.getHttpServer()).post('/v1/booking-intents/i-rejected/commit').set('x-actor-id', 'actor-1').send({ expectedVersion: 1, actionRequestId: auth.approved.id, mandateId: auth.mandate.id, idempotencyKey: 'rejected', selectedOfferSnapshotHash: 'offer-v1' });
    expect(committed.status).toBe(202);
    expect(committed.body.intent.status).toBe('failed');
    expect(committed.body.supplierOrder.lifecycleStatus).toBe('failed');
    (app.get(BookingServiceImpl) as any).orders.setOutcome('pending');
  });

  it('returns 202 and preserves unknown supplier creation without false success', async () => {
    const created = await request(app.getHttpServer()).post('/v1/trips/trip-unknown/booking-intents').set('x-actor-id', 'actor-1').send({ id: 'i-unknown', offerId: 'o-unknown', offerKind: 'train', supplierId: 'mock-train', selectedOfferSnapshotHash: 'offer-v1', originalPriceCents: 1000, refundRulesHash: 'rules-v1', travelerDataGrantId: 'g-unknown', refundable: true, travelerIds: ['traveler-1'], requestedSensitiveFields: ['fullName'], travelerDataPurpose: 'ticketing' });
    expect(created.status).toBe(201);
    const auth = await authorize('i-unknown', 'o-unknown', 'g-unknown', undefined, 'trip-unknown');
    (app.get(BookingServiceImpl) as any).orders.setOutcome('indeterminate');
    const committed = await request(app.getHttpServer()).post('/v1/booking-intents/i-unknown/commit').set('x-actor-id', 'actor-1').send({ expectedVersion: 1, actionRequestId: auth.approved.id, mandateId: auth.mandate.id, idempotencyKey: 'unknown', selectedOfferSnapshotHash: 'offer-v1' });
    expect(committed.status).toBe(202);
    expect(committed.body.supplierOrder.lifecycleStatus).toBe('creation_unknown');
    (app.get(BookingServiceImpl) as any).orders.setOutcome('pending');
  });

  it('pauses on changed revalidation and resumes only with a fresh bound decision', async () => {
    const created = await request(app.getHttpServer()).post('/v1/trips/trip-resume/booking-intents').set('x-actor-id', 'actor-1').send({ id: 'i-resume', offerId: 'o-resume', offerKind: 'train', supplierId: 'mock-train', selectedOfferSnapshotHash: 'offer-v1', originalPriceCents: 1000, refundRulesHash: 'rules-v1', travelerDataGrantId: 'g-resume', refundable: true, travelerIds: ['traveler-1'], requestedSensitiveFields: ['fullName'], travelerDataPurpose: 'ticketing' });
    expect(created.status).toBe(201);
    const auth = await authorize('i-resume', 'o-resume', 'g-resume', undefined, 'trip-resume');
    const orders = (app.get(BookingServiceImpl) as any).orders;
    orders.setSnapshotHash('offer-v2'); orders.setPriceCents(1100);
    const paused = await request(app.getHttpServer()).post('/v1/booking-intents/i-resume/commit').set('x-actor-id', 'actor-1').send({ expectedVersion: 1, actionRequestId: auth.approved.id, mandateId: auth.mandate.id, idempotencyKey: 'pause', selectedOfferSnapshotHash: 'offer-v1' });
    expect(paused.status).toBe(202);
    expect(paused.body.intent.status).toBe('awaiting_user_decision');
    const fresh = await authorize('i-resume', 'o-resume', 'g-resume', undefined, 'trip-resume', paused.body.intent.version);
    orders.setSnapshotHash('offer-v1'); orders.setPriceCents(1000);
    const resumed = await request(app.getHttpServer()).post('/v1/booking-intents/i-resume/commit').set('x-actor-id', 'actor-1').send({ expectedVersion: paused.body.intent.version, actionRequestId: fresh.approved.id, mandateId: fresh.mandate.id, idempotencyKey: 'resume', selectedOfferSnapshotHash: 'offer-v1' });
    expect(resumed.status).toBe(202);
    expect(resumed.body.intent.status).toBe('awaiting_supplier');
  });
});
