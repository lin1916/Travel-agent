import { BaseMockAdapter, type RawOffer } from './base-mock-adapter.js';
import type { FaultMode } from './fault-mode.js';
const fixture: RawOffer[] = [
  { id: 'train-001', kind: 'train', supplierId: 'mock-rail', title: '高铁二等座', amountCents: 19800, totalMinutes: 150, transferCount: 0, locationScore: 0.9, rating: 4.7, refundFlexibility: 0.7, refundSummary: '可在发车前按规则退改' },
  { id: 'train-002', kind: 'train', supplierId: 'mock-rail', title: '高铁一等座', amountCents: 29800, totalMinutes: 145, transferCount: 0, locationScore: 0.9, rating: 4.8, refundFlexibility: 0.8, refundSummary: '可在发车前按规则退改' },
  { id: 'flight-001', kind: 'flight', supplierId: 'mock-air', title: '直飞经济舱', amountCents: 32800, totalMinutes: 135, transferCount: 0, locationScore: 0.85, rating: 4.5, refundFlexibility: 0.6, refundSummary: '起飞前按规则退改' },
  { id: 'flight-002', kind: 'flight', supplierId: 'mock-air', title: '直飞公务舱', amountCents: 96800, totalMinutes: 125, transferCount: 0, locationScore: 0.9, rating: 4.8, refundFlexibility: 0.8, refundSummary: '起飞前按规则退改' },
];
export class MockTransportAdapter extends BaseMockAdapter {
  readonly kind = 'train' as const;
  readonly supplierId = 'mock-rail';
  protected readonly fixture = fixture;
  protected override supportsKind(kind: 'train' | 'flight'): boolean { return kind === 'train' || kind === 'flight'; }
}
