import { describe, expect, it } from 'vitest';
import { AppErrorSchema, EventEnvelopeSchema, MoneySchema, createAppError, toPublicError, SupplierWebhookSchema, RevalidateRequestSchema, CreateSupplierOrderSchema, SupplierOrderSnapshotSchema, SupplierOfferSchema, TravelMandateSchema, ActionRequestInputSchema, CancelRequestSchema, RefundRequestSchema, PolicySnapshotSchema } from '../src/index.js';

describe('shared contract schemas', () => {
  it('accepts only non-negative CNY integer cents', () => {
    expect(MoneySchema.parse({ amountCents: 1234, currency: 'CNY' })).toEqual({ amountCents: 1234, currency: 'CNY' });
    expect(MoneySchema.safeParse({ amountCents: -1, currency: 'CNY' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amountCents: 1.5, currency: 'CNY' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amountCents: 1, currency: 'USD' }).success).toBe(false);
  });

  it('requires event sequence and schema version', () => {
    const base = {
      event_id: 'evt-1', event_type: 'TripCreated', aggregate_type: 'Trip', aggregate_id: 'trip-1',
      occurred_at: new Date().toISOString(), request_id: 'req-1', correlation_id: 'corr-1', redacted_payload: {},
    };
    expect(EventEnvelopeSchema.safeParse(base).success).toBe(false);
    expect(EventEnvelopeSchema.parse({ ...base, sequence: 1, schema_version: 1 })).toMatchObject({ sequence: 1, schema_version: 1 });
  });

  it('keeps provider detail out of public errors', () => {
    const error = AppErrorSchema.parse({ code: 'supplier_unavailable', httpStatus: 503, retryable: true, publicMessage: 'Supplier is temporarily unavailable', correlationId: 'corr-1', internalDetail: 'provider token abc' });
    expect(toPublicError(error)).not.toHaveProperty('internalDetail');
    expect(toPublicError(error).publicMessage).not.toContain('abc');
  });

  it('maps every public error code to its stable HTTP semantics', () => {
    const expected = {
      validation_error: [400, false], unauthorized: [401, false], forbidden: [403, false],
      conflict: [409, false], policy_blocked: [422, false], supplier_unavailable: [503, true],
      unknown_external_result: [202, false],
    } as const;
    for (const [code, [status, retryable]] of Object.entries(expected)) {
      const error = createAppError(code as keyof typeof expected, 'corr-1', 'field=value from provider');
      expect(error.httpStatus).toBe(status);
      expect(error.retryable).toBe(retryable);
      expect(error.publicMessage).not.toContain('field=value');
      expect(AppErrorSchema.parse(error).code).toBe(code);
    }
  });

  it('parses supplier, search, mandate, action, and policy boundary inputs', () => {
    expect(RevalidateRequestSchema.parse({ supplierId: 'mock', offerSnapshotHash: 'hash', offerId: 'offer' }).offerId).toBe('offer');
    expect(CreateSupplierOrderSchema.parse({ intentId: 'intent', offerSnapshotHash: 'hash', travelerDataGrantId: 'grant', executionAuthorizationRef: 'auth', externalIdempotencyKey: 'key' }).intentId).toBe('intent');
    expect(SupplierWebhookSchema.parse({ supplierId: 'mock', rawBody: new Uint8Array([1]), headers: {} }).supplierId).toBe('mock');
    expect(SupplierOrderSnapshotSchema.parse({ lifecycleStatus: 'creation_unknown', reconciliationStatus: 'pending' }).lifecycleStatus).toBe('creation_unknown');
    expect(SupplierOfferSchema.parse({ id: 'offer', kind: 'train', supplierId: 'mock', price: { amountCents: 100, currency: 'CNY' }, snapshotHash: 'hash' }).kind).toBe('train');
    expect(TravelMandateSchema.parse({ id: 'm', tripId: 't', version: 1, totalBudgetLimit: { amountCents: 100, currency: 'CNY' }, categoryLimits: {}, allowedBookingTypes: ['train'], allowedSuppliers: ['mock'], refundableOnly: false, maxSingleOrderAmount: { amountCents: 100, currency: 'CNY' }, allowedSensitiveFields: ['name'], validUntil: new Date().toISOString(), exceptionPolicy: 'none' }).id).toBe('m');
    expect(ActionRequestInputSchema.parse({ tripId: 't', resourceId: 'r', kind: 'booking', risk: 'commit' }).kind).toBe('booking');
    expect(CancelRequestSchema.parse({ orderId: 'o', reason: 'changed', expectedVersion: 1 }).orderId).toBe('o');
    expect(RefundRequestSchema.parse({ orderId: 'o', amount: { amountCents: 10, currency: 'CNY' }, reason: 'changed', expectedVersion: 1 }).orderId).toBe('o');
    expect(PolicySnapshotSchema.parse({ currentTripVersion: 1, currentBudget: { totalLimit: { amountCents: 100, currency: 'CNY' }, categoryLimits: {}, estimated: { amountCents: 0, currency: 'CNY' }, reserved: { amountCents: 0, currency: 'CNY' }, committed: { amountCents: 0, currency: 'CNY' }, paid: { amountCents: 0, currency: 'CNY' }, released: { amountCents: 0, currency: 'CNY' }, categoryPaid: {} }, currentOfferSnapshotHash: 'h', now: new Date().toISOString() }).currentBudget.totalLimit.currency).toBe('CNY');
  });
});
