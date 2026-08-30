import { describe, expect, it } from 'vitest';
import { ActionRequestService } from '@travel/application';
import { createExecutionPolicyEvaluator } from '../src/modules/agent/agent.module.js';

const mandate = { id: 'm-1', tripId: 'trip-1', version: 1, totalBudgetLimit: { amountCents: 10000, currency: 'CNY' as const }, categoryLimits: { transport: { amountCents: 10000, currency: 'CNY' as const } }, allowedBookingTypes: ['train' as const], allowedSuppliers: ['supplier-1'], refundableOnly: true, maxSingleOrderAmount: { amountCents: 5000, currency: 'CNY' as const }, allowedSensitiveFields: [], validUntil: '2026-12-01T00:00:00.000Z', exceptionPolicy: 'none' };
const snapshot = { currentTripVersion: 1, currentBudget: { totalLimit: { amountCents: 10000, currency: 'CNY' as const }, categoryLimits: { transport: { amountCents: 10000, currency: 'CNY' as const } }, estimated: { amountCents: 0, currency: 'CNY' as const }, reserved: { amountCents: 0, currency: 'CNY' as const }, committed: { amountCents: 0, currency: 'CNY' as const }, paid: { amountCents: 0, currency: 'CNY' as const }, released: { amountCents: 0, currency: 'CNY' as const }, categoryPaid: {} }, currentOfferSnapshotHash: 'offer-v1', now: '2026-08-30T00:00:00.000Z' };

describe('agent execution policy', () => {
  it('loads the latest mandate, evaluates facts, and consumes the exact approved request', async () => {
    const actions = new ActionRequestService();
    const created = await actions.create('owner-1', { tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit', supplierId: 'supplier-1', bookingType: 'train', refundable: true, offerSnapshotHash: 'offer-v1', requestedAmount: { amountCents: 1000, currency: 'CNY' } }, { correlationId: 'corr', policySnapshot: snapshot });
    await actions.decide(created.id, 'owner-1', { approved: true, reason: 'go', expectedVersion: created.version });
    let latest = mandate;
    const evaluator = createExecutionPolicyEvaluator({ get: async () => latest }, actions);
    const result = await evaluator({ actorId: 'owner-1', actionRequestId: created.id, mandateId: latest.id }, {});
    expect(result.allowed).toBe(true);
    latest = { ...latest, version: 2, revokedAt: '2026-08-30T00:00:00.000Z' };
    const denied = await evaluator({ actorId: 'owner-1', actionRequestId: created.id, mandateId: latest.id }, {});
    expect(denied.allowed).toBe(false);
    latest = mandate;
    await result.consume?.();
    expect((await actions.get(created.id, 'owner-1'))?.status).toBe('executed');
  });
});
