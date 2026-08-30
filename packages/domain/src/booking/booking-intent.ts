import type { BookingIntent, OfferKind, BookingIntentStatus } from '@travel/contracts';
import { canTransitionBookingIntent } from './booking-state-machine.js';

export interface BookingIntentAggregate extends BookingIntent {
  selectedOfferSnapshotHash?: string;
  revalidation?: { unchanged: boolean; currentOfferSnapshotHash: string; priceChanged: boolean; inventoryChanged: boolean; refundRulesChanged: boolean };
}

export function createBookingIntent(input: { id: string; tripId: string; offerId: string; offerKind: OfferKind; selectedOfferSnapshotHash?: string }): BookingIntentAggregate {
  return { ...input, status: 'draft', version: 1 };
}

export function transitionBookingIntent(intent: BookingIntentAggregate, status: BookingIntentStatus): BookingIntentAggregate {
  if (!canTransitionBookingIntent(intent.status, status)) throw new Error(`invalid transition from ${intent.status} to ${status}`);
  return { ...structuredClone(intent), status, version: intent.version + 1 };
}
