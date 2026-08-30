import { describe, expect, it } from 'vitest';
import { BookingServiceImpl, InMemoryBookingStore } from '../src/booking/booking-service.js';
import { MockOrderService } from '@travel/supplier-adapters';

const create = async (service: BookingServiceImpl, grantId = 'grant-1') => service.create('actor-1', {
  id: 'intent-1', tripId: 'trip-1', offerId: 'offer-1', offerKind: 'train', supplierId: 'mock-train',
  selectedOfferSnapshotHash: 'offer-v1', originalPriceCents: 1000, refundRulesHash: 'rules-v1', travelerDataGrantId: grantId,
});

describe('booking service', () => {
  it('pauses a commit and requires a fresh decision after revalidation changes', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v2', priceCents: 1100 }));
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

  it('creates an awaiting-payment mock order after a consumed decision', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'accepted', snapshotHash: 'offer-v1' }));
    await create(service);
    const result = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'approved-once', idempotencyKey: 'commit-2', selectedOfferSnapshotHash: 'offer-v1' });
    expect(result.intent.status).toBe('awaiting_supplier');
    expect(result.supplierOrder).toMatchObject({ lifecycleStatus: 'awaiting_payment' });
    await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: result.intent.version, actionRequestId: 'approved-once', idempotencyKey: 'commit-3', selectedOfferSnapshotHash: 'offer-v1' })).rejects.toThrow();
  });

  it('records indeterminate supplier creation as unknown rather than success', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'indeterminate', snapshotHash: 'offer-v1' }));
    await create(service);
    const result = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'approved-once', idempotencyKey: 'commit-4', selectedOfferSnapshotHash: 'offer-v1' });
    expect(result.intent.status).toBe('awaiting_supplier');
    expect(result.supplierOrder).toMatchObject({ lifecycleStatus: 'creation_unknown', reconciliationStatus: 'manual_review' });
  });

  it('requires an authorization reference and rejects browser hash tampering', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'pending', snapshotHash: 'offer-v1' }));
    await create(service);
    await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, idempotencyKey: 'missing-auth', selectedOfferSnapshotHash: 'offer-v1' })).rejects.toThrow();
    await expect(service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, mandateId: 'mandate-1', idempotencyKey: 'tampered', selectedOfferSnapshotHash: 'browser-fake' })).rejects.toThrow();
  });

  it('maps rejected supplier creation to a failed intent', async () => {
    const service = new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService({ outcome: 'rejected', snapshotHash: 'offer-v1' }));
    await create(service);
    const result = await service.commit('actor-1', { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'approved', idempotencyKey: 'rejected', selectedOfferSnapshotHash: 'offer-v1' });
    expect(result.intent.status).toBe('failed');
    expect(result.supplierOrder?.lifecycleStatus).toBe('failed');
  });
});
