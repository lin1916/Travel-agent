import { describe, expect, it } from 'vitest';
import { GovernedBookingAuthorization, BookingServiceImpl, InMemoryBookingStore } from '../src/booking/booking-service.js';
import { ActionRequestService } from '../src/action-requests/action-request-service.js';
import { MockOrderService } from '@travel/supplier-adapters';
import { RedirectTokenServiceImpl } from '@travel/supplier-adapters';
import { MandateStore } from '@travel/domain';

class ClaimTrackingBookingStore extends InMemoryBookingStore {
  readonly claims: string[] = [];
  async claimCommit(_actorId: string, idempotencyKey: string): Promise<'claimed'> {
    this.claims.push(idempotencyKey);
    return 'claimed';
  }
}

const auth = { authorize: async (actorId: string, intent: any, input: any) => { if (actorId !== 'actor-1') throw new Error('forbidden'); if (!input.actionRequestId && !input.mandateId) throw new Error('authorization required'); return { consume: async () => undefined }; } };

const create = async (service: BookingServiceImpl, grantId = 'grant-1') => service.create('actor-1', {
  id: 'intent-1', tripId: 'trip-1', offerId: 'offer-1', offerKind: 'train', supplierId: 'mock-train',
  selectedOfferSnapshotHash: 'offer-v1', originalPriceCents: 1000, refundRulesHash: 'rules-v1', refundable: true,
  startsAt: '2026-09-10T08:00:00.000+08:00', endsAt: '2026-09-10T10:00:00.000+08:00',
  travelerDataGrantId: grantId, travelerDataGrantExpiresAt: '2026-09-10T07:05:00.000+08:00', travelerIds: ['traveler-1'],
  requestedSensitiveFields: ['fullName'], travelerDataPurpose: 'ticketing',
});

const policySnapshot = {
  currentTripVersion: 1,
  currentBudget: {
    totalLimit: { amountCents: 10_000, currency: 'CNY' as const }, categoryLimits: {}, estimated: { amountCents: 0, currency: 'CNY' as const },
    reserved: { amountCents: 0, currency: 'CNY' as const }, committed: { amountCents: 0, currency: 'CNY' as const },
    paid: { amountCents: 0, currency: 'CNY' as const }, released: { amountCents: 0, currency: 'CNY' as const }, categoryPaid: {},
  },
  currentOfferSnapshotHash: 'offer-v1', now: '2026-09-10T07:00:00.000+08:00',
};

async function governedAuthorization(options: { overlap?: boolean; budgetLimit?: number; grantAllowed?: boolean } = {}) {
  const actions = new ActionRequestService(() => new Date('2026-09-10T07:00:00.000+08:00'));
  const mandates = new MandateStore();
  const mandate = mandates.create('actor-1', {
    id: 'mandate-1', tripId: 'trip-1', totalBudgetLimit: { amountCents: options.budgetLimit ?? 10_000, currency: 'CNY' }, categoryLimits: {},
    allowedBookingTypes: ['train'], allowedSuppliers: ['mock-train'], refundableOnly: true,
    maxSingleOrderAmount: { amountCents: 5_000, currency: 'CNY' }, allowedSensitiveFields: ['fullName'],
    validUntil: '2026-09-11T00:00:00.000+08:00', exceptionPolicy: 'none',
  });
  const action = await actions.create('actor-1', {
    tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit', requestedAmount: { amountCents: 1000, currency: 'CNY' },
    supplierId: 'mock-train', bookingType: 'train', refundable: true, offerSnapshotHash: 'offer-v1', requestedSensitiveFields: ['fullName'],
  }, { correlationId: 'booking-test', policySnapshot });
  const approved = await actions.decide(action.id, 'actor-1', { approved: true, reason: 'go', expectedVersion: action.version });
  let grantConsumes = 0;
  const authorization = new GovernedBookingAuthorization(actions, mandates, {
    snapshotFor: async () => ({ ...policySnapshot, currentBudget: { ...policySnapshot.currentBudget, totalLimit: { amountCents: options.budgetLimit ?? 10_000, currency: 'CNY' as const } }, itinerary: options.overlap ? [{ id: 'existing', version: 1, tripId: 'trip-1', category: 'transport' as const, startsAt: '2026-09-10T09:00:00.000+08:00', endsAt: '2026-09-10T11:00:00.000+08:00', confirmed: true }] : [] }),
  }, {
    findById: async (id: string) => options.grantAllowed === false ? null : ({ id, intentId: 'intent-1', intentVersion: 1, supplierLegalEntity: 'mock-train', travelerIds: ['traveler-1'], allowedFields: ['fullName'], purpose: 'ticketing', offerSnapshotHash: 'offer-v1', authorizationRef: approved.id, expiresAt: '2026-09-10T07:05:00.000+08:00', usedAt: null, revokedAt: null }),
    consumeOnce: async (_actorId, ref, context) => {
      if (options.grantAllowed === false || ref.id !== 'grant-1' || context.authorizationRef !== approved.id || context.intentId !== 'intent-1') throw new Error('grant is not authorized');
      grantConsumes += 1;
    },
  }, () => new Date('2026-09-10T07:00:00.000+08:00'));
  return { actions, mandate, approved, authorization, grantConsumes: () => grantConsumes };
}

describe('booking service', () => {
  it('pauses a commit and requires a fresh decision after revalidation changes', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v2', priceCents: 1100 }), undefined, auth);
    await create(service);
    const result = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'initial-decision', idempotencyKey: 'commit-1', selectedOfferSnapshotHash: 'offer-v1' });
    expect(result.intent).toMatchObject({ status: 'awaiting_user_decision' });
    expect(result.intent.revalidation).toMatchObject({ unchanged: false, priceChanged: true });
    expect(result.requiresAction).toBeDefined();
    (service as any).orders.setSnapshotHash('offer-v1');
    (service as any).orders.setPriceCents(1000);
    const resumed = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: result.intent.version, actionRequestId: 'fresh-decision', idempotencyKey: 'commit-resume', selectedOfferSnapshotHash: 'offer-v1' });
    expect(resumed.intent.status).toBe('awaiting_supplier');
  });

  it('does not claim durable idempotency for a revalidation pause', async () => {
    const store = new ClaimTrackingBookingStore();
    const service = new BookingServiceImpl(store, new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v2', priceCents: 1100 }), undefined, auth);
    await create(service);

    const result = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'initial-decision', idempotencyKey: 'pause-before-claim', selectedOfferSnapshotHash: 'offer-v1' });

    expect(result.intent.status).toBe('awaiting_user_decision');
    expect(store.claims).toEqual([]);
  });

  it('creates an awaiting-payment mock order after a consumed decision', async () => {
    const redirects = new RedirectTokenServiceImpl('test-booking-key');
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'accepted', snapshotHash: 'offer-v1' }), undefined, auth, redirects);
    await create(service);
    const result = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'approved-once', idempotencyKey: 'commit-2', selectedOfferSnapshotHash: 'offer-v1' });
    expect(result.intent.status).toBe('awaiting_supplier');
    expect(result.supplierOrder).toMatchObject({ lifecycleStatus: 'awaiting_payment' });
    expect(result.redirectUrl).toMatch(/^\/v1\/supplier-redirects\/mock-train\?token=/);
    await expect(redirects.verify(decodeURIComponent(result.redirectUrl!.split('token=')[1]!), new Date(), { actorId: 'actor-1', supplierId: 'mock-train' })).resolves.toMatchObject({ intentId: 'intent-1', supplierId: 'mock-train' });
    await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: result.intent.version, actionRequestId: 'approved-once', idempotencyKey: 'commit-3', selectedOfferSnapshotHash: 'offer-v1' })).rejects.toThrow();
  });

  it('records indeterminate supplier creation as unknown rather than success', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'indeterminate', snapshotHash: 'offer-v1' }), undefined, auth);
    await create(service);
    const result = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'approved-once', idempotencyKey: 'commit-4', selectedOfferSnapshotHash: 'offer-v1' });
    expect(result.intent.status).toBe('awaiting_supplier');
    expect(result.supplierOrder).toMatchObject({ lifecycleStatus: 'creation_unknown', reconciliationStatus: 'manual_review' });
  });

  it('requires an authorization reference and rejects browser hash tampering', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v1' }), undefined, auth);
    await create(service);
    await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, idempotencyKey: 'missing-auth', selectedOfferSnapshotHash: 'offer-v1' })).rejects.toThrow();
    await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, mandateId: 'mandate-1', idempotencyKey: 'tampered', selectedOfferSnapshotHash: 'browser-fake' })).rejects.toThrow();
  });

  it('maps rejected supplier creation to a failed intent', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'rejected', snapshotHash: 'offer-v1' }), undefined, auth);
    await create(service);
    const result = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'approved', idempotencyKey: 'rejected', selectedOfferSnapshotHash: 'offer-v1' });
    expect(result.intent.status).toBe('failed');
    expect(result.supplierOrder?.lifecycleStatus).toBe('failed');
  });

  it('fails closed when authorization lookup is unavailable', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v1' }));
    await create(service);
    await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'a', idempotencyKey: 'lookup', selectedOfferSnapshotHash: 'offer-v1' })).rejects.toThrow();
  });

  it('requires a current mandate, current policy facts, and a bound one-use traveler grant', async () => {
    const governed = await governedAuthorization();
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v1' }), undefined, governed.authorization);
    await create(service);
    await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: governed.approved.id, mandateId: governed.mandate.id, idempotencyKey: 'bound', selectedOfferSnapshotHash: 'offer-v1' });
    expect((await governed.actions.getRecord(governed.approved.id, 'actor-1')).status).toBe('executed');
    expect(governed.grantConsumes()).toBe(1);
  });

  it('fails closed for budget excess, direct overlap, or mismatched grant', async () => {
    for (const [name, options] of [
      ['budget', { budgetLimit: 500 }], ['overlap', { overlap: true }], ['grant', { grantAllowed: false }],
    ] as const) {
      const governed = await governedAuthorization(options);
      const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v1' }), undefined, governed.authorization);
      await create(service);
      await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: governed.approved.id, mandateId: governed.mandate.id, idempotencyKey: name, selectedOfferSnapshotHash: 'offer-v1' })).rejects.toThrow();
    }
  });

  it('fails closed when the mandate reference is omitted', async () => {
    const governed = await governedAuthorization();
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v1' }), undefined, governed.authorization);
    await create(service);
    await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: governed.approved.id, idempotencyKey: 'missing-mandate', selectedOfferSnapshotHash: 'offer-v1' })).rejects.toThrow();
  });
});
