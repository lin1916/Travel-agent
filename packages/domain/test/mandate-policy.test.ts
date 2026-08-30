import { describe, expect, it } from 'vitest';
import type { PolicySnapshot, TravelMandate } from '@travel/contracts';
import { evaluateExecutionPolicy } from '../src/mandate/policy-evaluator.js';
import { MandateStore } from '../src/mandate/mandate.js';

const snapshot = (overrides: Partial<PolicySnapshot> = {}): PolicySnapshot => ({
  currentTripVersion: 1,
  currentOfferSnapshotHash: 'offer-v1',
  now: '2026-08-30T00:00:00.000Z',
  currentBudget: {
    totalLimit: { amountCents: 100_000, currency: 'CNY' }, categoryLimits: {},
    estimated: { amountCents: 0, currency: 'CNY' }, reserved: { amountCents: 0, currency: 'CNY' },
    committed: { amountCents: 0, currency: 'CNY' }, paid: { amountCents: 0, currency: 'CNY' },
    released: { amountCents: 0, currency: 'CNY' }, categoryPaid: {},
  },
  ...overrides,
});

const mandate = (overrides: Partial<TravelMandate> = {}): TravelMandate => ({
  id: 'm-1', tripId: 'trip-1', version: 1,
  totalBudgetLimit: { amountCents: 100_000, currency: 'CNY' }, categoryLimits: {},
  allowedBookingTypes: ['train'], allowedSuppliers: ['supplier-1'], refundableOnly: false,
  maxSingleOrderAmount: { amountCents: 50_000, currency: 'CNY' }, allowedSensitiveFields: ['name'],
  validUntil: '2026-09-01T00:00:00.000Z', exceptionPolicy: 'none', ...overrides,
});

describe('execution policy', () => {
  it('requires per-order confirmation by default', () => {
    const decision = evaluateExecutionPolicy({ tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit', requestedAmount: { amountCents: 1_000, currency: 'CNY' } }, null, snapshot());
    expect(decision).toMatchObject({ allowed: false, requiresFreshUserDecision: true });
  });

  it('allows a booking inside a valid mandate', () => {
    const decision = evaluateExecutionPolicy({ tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit', bookingType: 'train', supplierId: 'supplier-1', refundable: true, offerSnapshotHash: 'offer-v1', requestedAmount: { amountCents: 1_000, currency: 'CNY' } }, mandate(), snapshot());
    expect(decision.allowed).toBe(true);
    expect(decision.mandateVersion).toBe(1);
  });

  it('blocks over-budget, supplier, refundability, expiry and revocation violations', () => {
    const action = { tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking' as const, risk: 'commit' as const, bookingType: 'train' as const, supplierId: 'bad', refundable: false, requestedAmount: { amountCents: 60_000, currency: 'CNY' as const } };
    expect(evaluateExecutionPolicy(action, mandate({ refundableOnly: true }), snapshot()).allowed).toBe(false);
    expect(evaluateExecutionPolicy(action, mandate({ validUntil: '2026-01-01T00:00:00.000Z' }), snapshot()).reasons.some(r => r.code === 'mandate_expired')).toBe(true);
    expect(evaluateExecutionPolicy(action, mandate({ revokedAt: '2026-08-01T00:00:00.000Z' }), snapshot()).reasons.some(r => r.code === 'mandate_revoked')).toBe(true);
  });

  it('requires a fresh decision for price changes and high-risk cancellation', () => {
    const price = evaluateExecutionPolicy({ tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit', bookingType: 'train', supplierId: 'supplier-1', offerSnapshotHash: 'offer-v2', requestedAmount: { amountCents: 1_000, currency: 'CNY' } }, mandate(), snapshot());
    expect(price.requiresFreshUserDecision).toBe(true);
    const cancel = evaluateExecutionPolicy({ tripId: 'trip-1', resourceId: 'order-1', kind: 'cancel', risk: 'redirect' }, mandate(), snapshot());
    expect(cancel.requiresFreshUserDecision).toBe(true);
  });

  it('keeps mandate amendments and revocations as immutable versions', () => {
    const store = new MandateStore();
    const first = store.create('owner-1', mandate());
    const second = store.amend(first.id, 'owner-1', 1, { maxSingleOrderAmount: { amountCents: 20_000, currency: 'CNY' } });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(store.get(first.id, 'owner-1', 1)?.maxSingleOrderAmount.amountCents).toBe(50_000);
    expect(store.revoke(first.id, 'owner-1', 2).version).toBe(3);
  });
});
