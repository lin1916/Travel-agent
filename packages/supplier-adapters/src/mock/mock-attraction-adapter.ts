import { BaseMockAdapter, type RawOffer } from './base-mock-adapter.js';
import type { FaultMode } from './fault-mode.js';
const fixture: RawOffer[] = [
  { id: 'attraction-001', kind: 'attraction', supplierId: 'mock-attraction', title: '西湖景区门票', amountCents: 9000, locationScore: 0.96, rating: 4.8, refundFlexibility: 0.6, refundSummary: '未使用可申请退款' },
  { id: 'attraction-002', kind: 'attraction', supplierId: 'mock-attraction', title: '良渚博物院门票', amountCents: 5000, locationScore: 0.72, rating: 4.7, refundFlexibility: 0.5, refundSummary: '未使用可申请退款' },
];
export class MockAttractionAdapter extends BaseMockAdapter { readonly kind = 'attraction' as const; readonly supplierId = 'mock-attraction'; protected readonly fixture = fixture; }
