import { describe, expect, it } from 'vitest';
import { ActionRequestController } from '../src/modules/action-requests/action-request.controller.js';
import { BookingController } from '../src/modules/bookings/booking.controller.js';

describe('request correlation propagation', () => {
  it('uses the server-issued request context for action requests', async () => {
    let options: any;
    const controller = new ActionRequestController({
      create: async (_actor: string, _input: unknown, received: unknown) => { options = received; return {}; },
    } as any);
    await controller.create({ actor: { actorId: 'actor-1' }, headers: { 'x-correlation-id': 'caller-phone-13800138000' }, requestId: 'req-server', correlationId: 'corr-server' } as any, { tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit' });
    expect(options).toEqual({ requestId: 'req-server', correlationId: 'corr-server' });
  });

  it('uses the server-issued request context for booking creation and commit', async () => {
    const calls: any[] = [];
    const controller = new BookingController({
      create: async (_actor: string, input: any) => { calls.push({ type: 'create', input }); return {}; },
      commit: async (_actor: string, input: any) => { calls.push({ type: 'commit', input }); return {}; },
    } as any);
    const request = { requestId: 'req-server', correlationId: 'corr-server' };
    await controller.create('actor-1', request, 'trip-1', { id: 'intent-1', offerId: 'offer-1', offerKind: 'train', supplierId: 'supplier-1', selectedOfferSnapshotHash: 'hash-1', originalPriceCents: 100, refundRulesHash: 'rules-1', travelerDataGrantId: 'grant-1' });
    await controller.commit('actor-1', request, 'intent-1', { expectedVersion: 1, actionRequestId: 'action-1', mandateId: 'mandate-1', idempotencyKey: 'key-1', selectedOfferSnapshotHash: 'hash-1' });
    expect(calls[0].input).toMatchObject({ requestId: 'req-server', correlationId: 'corr-server' });
    expect(calls[1].input).toMatchObject({ requestId: 'req-server', correlationId: 'corr-server' });
  });

  it('rejects caller-supplied traveler references at the booking boundary', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const controller = new BookingController({ create: async () => ({}) } as any);
    try {
      await expect(controller.create('actor-1', { requestId: 'req-server', correlationId: 'corr-server' }, 'trip-1', { id: 'intent-1', offerId: 'offer-1', offerKind: 'train', supplierId: 'supplier-1', selectedOfferSnapshotHash: 'hash-1', originalPriceCents: 100, refundRulesHash: 'rules-1', travelerDataGrantId: 'grant-1', travelerIds: ['traveler-aaaaaaaaaaaaaaa1'] })).rejects.toThrow(/unrecognized|invalid/i);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
