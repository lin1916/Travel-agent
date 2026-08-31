import { describe, expect, it } from 'vitest';
import { faultModes, runFullTripScenario } from '../src/index.js';

describe('full mock travel workflow', () => {
  it('completes the deterministic four-category trip workflow', () => {
    const result = runFullTripScenario();
    expect(result.trip).toMatchObject({ id: 'trip-demo-001', destination: '杭州', travelerCount: 2 });
    expect(result.search).toMatchObject({ status: 'completed', categories: ['train', 'stay', 'attraction', 'dining'] });
    expect(result.travelers).toHaveLength(2);
    expect(result.grant.allowedFields).toEqual(['fullName']);
    expect(result.mandate.allowedBookingTypes).toEqual(['train', 'stay']);
    expect(result.apiOrder.status).toBe('confirmed');
    expect(result.redirectOrder.status).toBe('confirmed');
    expect(result.itinerary.confirmedItems).toHaveLength(2);
    expect(result.budget.paid).toEqual({ amountCents: 3000, currency: 'CNY' });
    expect(result.unknownOrder.reconciliationStatus).toBe('pending');
    expect(result.leakScan.matches).toEqual([]);
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
  });
});
