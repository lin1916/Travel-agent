import { describe, expect, it } from 'vitest';
import { executeFullTripScenario, faultModes, runFullTripScenario } from '../src/index.js';

describe('full mock travel workflow', () => {
  it('completes the deterministic four-category trip workflow', () => {
    const result = runFullTripScenario();
    expect(result.trip).toMatchObject({ id: 'trip-demo-001', destination: '杭州', travelerCount: 2 });
    expect(result.auth).toMatchObject({ anonymousCanPlan: true, bookingRequiresLogin: true });
    expect(result.auth.loginGate).toEqual({ planning: 'anonymous', save: 'authenticated', booking: 'authenticated' });
    expect(result.travelerLimit).toEqual({ accepted: 6, rejectedAt: 7 });
    expect(result.grant).toMatchObject({ intentVersion: 1, authorizationRef: 'action-demo-001', travelerIds: expect.arrayContaining(['traveler-ref-001', 'traveler-ref-002']) });
    expect(result.mandate).toMatchObject({ tripId: 'trip-demo-001', ownerId: 'actor-demo-001', version: 1, grantId: 'grant-demo-001', budgetWarningAtCents: 16_000, budgetBlockedAtCents: 20_001, explicitOverrideRequired: true });
    expect(result.workflow).toEqual(expect.arrayContaining(['anonymous_trip_created', 'login_required', 'grant_issued', 'mandate_bounded', 'unknown_order_reconciled', 'views_exposed']));
    expect(result.search).toMatchObject({ status: 'completed', categories: ['train', 'stay', 'attraction', 'dining'], selectedOfferIds: ['offer-train-001', 'offer-stay-001', 'offer-attraction-001', 'offer-dining-001'] });
    expect(result.travelers).toHaveLength(6);
    expect(result.grant.allowedFields).toEqual(['fullName']);
    expect(result.mandate.allowedBookingTypes).toEqual(['train', 'stay']);
    expect(result.apiOrder.status).toBe('confirmed');
    expect(result.redirectOrder.status).toBe('confirmed');
    expect(result.itinerary.confirmedItems).toHaveLength(2);
    expect(result.budget.paid).toEqual({ amountCents: 3000, currency: 'CNY' });
    expect(result.unknownOrder.reconciliationStatus).toBe('pending');
    expect(result.unknownOrder).toMatchObject({ lifecycleStatus: 'creation_unknown', notAssumedSuccessful: true });
    expect(result.bookingModel).toEqual({ intentStatus: 'awaiting_supplier', supplierOrderLifecycle: 'confirmed', paymentBoundary: 'api', idempotencyKey: 'booking:intent-demo-001:commit-demo-001', version: 1, policyDecision: 'allowed', auditEvent: 'BookingAuthorizationConsumed', overlapChecked: true });
    expect(result.redirectModel).toEqual({ supplierOrderLifecycle: 'confirmed', paymentBoundary: 'redirect', redirectUrl: 'https://mock.example/pay/order-redirect-001' });
  });

  it('covers every required deterministic fault mode', () => {
    expect(faultModes).toEqual([
      'normal', 'offer_expired', 'inventory_lost', 'price_changed', 'duplicate_webhook',
      'out_of_order_webhook', 'worker_crash', 'sse_reconnect', 'vault_kms_outage',
      'mandate_revoked', 'partial_success',
    ]);
    for (const fault of faultModes) {
      const result = runFullTripScenario({ fault });
    }
    expect(runFullTripScenario({ fault: 'duplicate_webhook' }).callbacks.duplicateRejected).toBe(1);
    expect(runFullTripScenario({ fault: 'out_of_order_webhook' }).callbacks.outOfOrderBuffered).toBe(1);
    expect(runFullTripScenario({ fault: 'mandate_revoked' }).mandate.revoked).toBe(true);
    expect(runFullTripScenario({ fault: 'partial_success' }).redirectOrder.status).toBe('pending');
    expect(runFullTripScenario({ fault: 'partial_success' }).budget.paid.amountCents).toBe(1500);
    expect(runFullTripScenario({ fault: 'worker_crash' }).workflow).toContain('worker_reclaimed');
    expect(runFullTripScenario({ fault: 'sse_reconnect' }).workflow).toContain('sse_replayed');
    expect(runFullTripScenario({ fault: 'mandate_revoked' }).workflow).toContain('mandate_blocked');
    expect(runFullTripScenario({ fault: 'price_changed' }).search.selectedOfferIds).toEqual([]);
    const revalidation = runFullTripScenario({ fault: 'price_changed' });
    expect(revalidation.apiOrder.status).not.toBe('confirmed');
    expect(revalidation.redirectOrder.status).not.toBe('confirmed');
    expect(revalidation.workflow).not.toContain('api_order_committed');
    expect(revalidation.requiresFreshDecision).toBe(true);
    for (const blocked of ['offer_expired', 'inventory_lost', 'vault_kms_outage', 'mandate_revoked'] as const) {
      const result = runFullTripScenario({ fault: blocked });
      expect(result.apiOrder.status, blocked).not.toBe('confirmed');
      expect(result.redirectOrder.status, blocked).not.toBe('confirmed');
      expect(result.workflow, blocked).not.toContain('api_order_committed');
      expect(result.workflow, blocked).not.toContain('redirect_order_committed');
    }
    expect(runFullTripScenario({ fault: 'vault_kms_outage' }).apiOrder.status).toBe('failed');
  });

  it('executes blocked faults through the real booking authorization seam', async () => {
    for (const fault of ['offer_expired', 'inventory_lost', 'vault_kms_outage', 'mandate_revoked'] as const) {
      const result = await executeFullTripScenario({ fault });
      expect(result.execution.mode, fault).toBe('executable');
      expect(result.execution.supplierOrdersCreated, fault).toBe(0);
      expect(result.execution.blockedWithoutSupplierOrder, fault).toBe(true);
    }
    const normal = await executeFullTripScenario();
    expect(normal.execution.supplierOrdersCreated).toBe(1);
    expect(normal.execution.bookingIntentCreated).toBe(true);
    expect(normal.execution.authorizationConsumed).toBe(true);
    expect(normal.execution.travelers.accepted).toBe(6);
    expect(normal.execution.travelers.seventhRejected).toBe(true);
    expect(normal.execution.grant.consumedOnce).toBe(true);
    expect(normal.execution.grant.secondConsumptionDenied).toBe(true);
    expect(normal.execution.mandate.boundToTrip).toBe(true);
    expect(normal.execution.budget).toEqual({ warning: true, blocked: true, overrideAttempted: false, overrideAllowed: false });
    const priceChanged = await executeFullTripScenario({ fault: 'price_changed' });
    expect(priceChanged.execution.supplierOrdersCreated).toBe(0);
    expect(priceChanged.execution.blockedWithoutSupplierOrder).toBe(false);
    expect(priceChanged.execution.authorizationConsumed).toBe(false);
  });

  it('persists actual recovery and privacy captures instead of flag projections', async () => {
    const result = await executeFullTripScenario({ fault: 'worker_crash' });
    expect(result.execution.recovery.browser.before.tripId).toBe('trip-demo-001');
    expect(result.execution.recovery.browser.after.tripId).toBe('trip-demo-001');
    expect(result.execution.recovery.worker.reclaimed).toBe(true);
    expect(result.execution.privacy.sources).toEqual(expect.arrayContaining(['agent', 'queue', 'outbox', 'sse', 'redirect', 'localStorage']));
    expect(result.execution.privacy.travelerPlaintextLeaks).toEqual([]);
  });
});
