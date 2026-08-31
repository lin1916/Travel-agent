import { describe, expect, it } from 'vitest';
import { faultModes, runFullTripScenario } from '@travel/testkit';

describe('full trip API fixture', () => {
  it('exposes the complete mock workflow state for API consumers', () => {
    const result = runFullTripScenario({ now: '2026-09-01T00:00:00.000+08:00' });
    expect(result.trip.id).toBe('trip-demo-001');
    expect(result.search.categories).toHaveLength(4);
    expect(result.apiOrder.status).toBe('confirmed');
    expect(result.redirectOrder.status).toBe('confirmed');
    expect(result.callbacks.accepted).toBe(2);
    expect(result.unknownOrder.reconciliationStatus).toBe('pending');
    expect(result.itinerary.confirmedItems.map(item => item.id)).toEqual(['item-train-001', 'item-stay-001']);
  });

  it('keeps every documented fault mode deterministic and non-leaking', () => {
    for (const fault of faultModes) expect(runFullTripScenario({ fault }).leakScan.matches).toEqual([]);
  });
});
