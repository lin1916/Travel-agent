import { BaseMockAdapter, type RawOffer } from './base-mock-adapter.js';
import type { FaultMode } from './fault-mode.js';
const fixture: RawOffer[] = [
  { id: 'stay-001', kind: 'stay', supplierId: 'mock-stay', title: '西湖附近精品酒店', amountCents: 68000, locationScore: 0.95, rating: 4.6, refundFlexibility: 0.9, refundSummary: '入住前一天可免费取消' },
  { id: 'stay-002', kind: 'stay', supplierId: 'mock-stay', title: '城市中心酒店', amountCents: 52000, locationScore: 0.82, rating: 4.3, refundFlexibility: 0.7, refundSummary: '入住前两天可免费取消' },
];
export class MockStayAdapter extends BaseMockAdapter { readonly kind = 'stay' as const; readonly supplierId = 'mock-stay'; protected readonly fixture = fixture; }
