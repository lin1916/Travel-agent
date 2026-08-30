import type { BookingIntent, OfferKind, BookingIntentStatus, Money } from '@travel/contracts';
import { canTransitionBookingIntent } from './booking-state-machine.js';

export interface BookingIntentAggregate extends BookingIntent {
  selectedOfferSnapshotHash?: string;
  supplierId?: string;
  supplierLegalEntity?: string;
  originalPriceCents?: number;
  offerAmount?: Money;
  refundRulesHash?: string;
  refundable?: boolean;
  travelerDataGrantId?: string;
  travelerDataGrantExpiresAt?: string;
  travelerIds?: string[];
  requestedSensitiveFields?: string[];
  travelerDataPurpose?: string;
  startsAt?: string;
  endsAt?: string;
  ownerId?: string;
  revalidation?: { unchanged: boolean; currentOfferSnapshotHash: string; priceChanged: boolean; inventoryChanged: boolean; refundRulesChanged: boolean };
}

export function createBookingIntent(input: { id: string; tripId: string; offerId: string; offerKind: OfferKind; selectedOfferSnapshotHash?: string }): BookingIntentAggregate {
  return { ...input, status: 'draft', version: 1 };
}

export function transitionBookingIntent(intent: BookingIntentAggregate, status: BookingIntentStatus): BookingIntentAggregate {
  if (!canTransitionBookingIntent(intent.status, status)) throw new Error(`invalid transition from ${intent.status} to ${status}`);
  return { ...structuredClone(intent), status, version: intent.version + 1 };
}
