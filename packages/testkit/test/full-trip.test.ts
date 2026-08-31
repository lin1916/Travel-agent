import { describe, expect, it } from 'vitest';
import { faultModes, runFullTripScenario } from '../src/index.js';

describe('full mock travel workflow', () => {
  it('completes the deterministic four-category trip workflow', () => {
    const result = runFullTripScenario();
    expect(result.trip).toMatchObject({ id: 'trip-demo-001', destination: '杭州', travelerCount: 2 });
    expect(result.auth).toEqual({ anonymousCanPlan: true, bookingRequiresLogin: true });
    expect(result.travelerLimit).toEqual({ accepted: 6, rejectedAt: 7 });
    expect(result.workflow).toEqual(expect.arrayContaining(['anonymous_trip_created', 'login_required', 'grant_issued', 'mandate_bounded', 'unknown_order_reconciled', 'views_exposed']));
    expect(result.search).toMatchObject({ status: 'completed', categories: ['train', 'stay', 'attraction', 'dining'], selectedOfferIds: ['offer-train-001', 'offer-stay-001', 'offer-attraction-001', 'offer-dining-001'] });
    expect(result.travelers).toHaveLength(2);
    expect(result.grant.allowedFields).toEqual(['fullName']);
    expect(result.mandate.allowedBookingTypes).toEqual(['train', 'stay']);
    expect(result.apiOrder.status).toBe('confirmed');
    expect(result.redirectOrder.status).toBe('confirmed');
    expect(result.itinerary.confirmedItems).toHaveLength(2);
    expect(result.budget.paid).toEqual({ amountCents: 3000, currency: 'CNY' });
    expect(result.unknownOrder.reconciliationStatus).toBe('pending');
    expect(result.leakScan.matches).toEqual([]);
    expect(result.leakScan.payloadsChecked).toBeGreaterThanOrEqual(3);
    expect(result.browserRefreshRecovered).toBe(true);
    expect(result.workerRestartRecovered).toBe(true);
  });

  it('covers every required deterministic fault mode', () => {
    expect(faultModes).toEqual([
      'normal', 'offer_expired', 'inventory_lost', 'price_changed', 'duplicate_webhook',
      'out_of_order_webhook', 'worker_crash', 'sse_reconnect', 'vault_kms_outage',
      'mandate_revoked', 'partial_success',
    ]);
    for (const fault of faultModes) {
      const result = runFullTripScenario({ fault });
      expect(result.leakScan.matches, fault).toEqual([]);
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
    expect(runFullTripScenario({ fault: 'vault_kms_outage' }).apiOrder.status).toBe('failed');
  });
});
