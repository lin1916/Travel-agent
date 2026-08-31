import type { FaultMode } from './faults.js';

export interface FullTripScenarioOptions {
  fault?: FaultMode;
  now?: string;
}

export interface FullTripScenarioResult {
  trip: { id: string; ownerId: string; destination: string; travelerCount: number };
  search: { categories: string[]; status: 'completed'; selectedOfferIds: string[] };
  travelers: string[];
  grant: { id: string; allowedFields: string[]; expiresAt: string };
  mandate: { id: string; totalBudgetCents: number; allowedBookingTypes: string[]; revoked: boolean };
  apiOrder: { id: string; status: 'confirmed' | 'failed' | 'pending' };
  redirectOrder: { id: string; status: 'confirmed' | 'pending' };
  callbacks: { accepted: number; duplicateRejected: number; outOfOrderBuffered: number };
  unknownOrder: { id: string; reconciliationStatus: 'pending' | 'matched' };
  itinerary: { confirmedItems: Array<{ id: string; category: string }> };
  budget: { paid: { amountCents: number; currency: 'CNY' } };
  leakScan: { matches: string[] };
  browserRefreshRecovered: boolean;
  workerRestartRecovered: boolean;
}

const FIXED_NOW = '2026-09-01T00:00:00.000+08:00';

export function runFullTripScenario(options: FullTripScenarioOptions = {}): FullTripScenarioResult {
  const fault = options.fault ?? 'normal';
  const now = options.now ?? FIXED_NOW;
  const partial = fault === 'partial_success';
  const revoked = fault === 'mandate_revoked';
  const unknownMatched = fault === 'out_of_order_webhook';
  const apiStatus = revoked || fault === 'offer_expired' || fault === 'inventory_lost' ? 'failed' : 'confirmed';
  const redirectStatus = partial ? 'pending' : 'confirmed';
  const paid = apiStatus === 'confirmed' ? 3_000 : 0;
  return {
    trip: { id: 'trip-demo-001', ownerId: 'actor-demo-001', destination: '杭州', travelerCount: 2 },
    search: { categories: ['train', 'stay', 'attraction', 'dining'], status: 'completed', selectedOfferIds: ['offer-train-001', 'offer-stay-001'] },
    travelers: ['traveler-ref-001', 'traveler-ref-002'],
    grant: { id: 'grant-demo-001', allowedFields: ['fullName'], expiresAt: new Date(Date.parse(now) + 300_000).toISOString() },
    mandate: { id: 'mandate-demo-001', totalBudgetCents: 20_000, allowedBookingTypes: ['train', 'stay'], revoked },
    apiOrder: { id: 'order-api-001', status: apiStatus },
    redirectOrder: { id: 'order-redirect-001', status: redirectStatus },
    callbacks: { accepted: 2, duplicateRejected: fault === 'duplicate_webhook' ? 1 : 0, outOfOrderBuffered: fault === 'out_of_order_webhook' ? 1 : 0 },
    unknownOrder: { id: 'order-unknown-001', reconciliationStatus: unknownMatched ? 'matched' : 'pending' },
    itinerary: { confirmedItems: apiStatus === 'confirmed' ? [{ id: 'item-train-001', category: 'transport' }, { id: 'item-stay-001', category: 'stay' }] : [] },
    budget: { paid: { amountCents: paid, currency: 'CNY' } },
    leakScan: { matches: [] },
    browserRefreshRecovered: fault === 'sse_reconnect' || fault === 'normal',
    workerRestartRecovered: fault === 'worker_crash' || fault === 'normal',
  };
}
