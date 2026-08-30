import { describe, expect, it } from 'vitest';
import { createBookingIntent, transitionBookingIntent, type BookingIntentAggregate } from '../src/booking/booking-intent.js';
import { canTransitionBookingIntent } from '../src/booking/booking-state-machine.js';

const intent = (): BookingIntentAggregate => createBookingIntent({
  id: 'intent-1', tripId: 'trip-1', offerId: 'offer-1', offerKind: 'train',
});

describe('booking intent state machine', () => {
  it('walks the governed happy path from draft to completion', () => {
    let current = intent();
    for (const status of ['awaiting_user_decision', 'validating', 'awaiting_traveler_data_grant', 'submitting', 'awaiting_supplier', 'completed'] as const) {
      expect(canTransitionBookingIntent(current.status, status)).toBe(true);
      current = transitionBookingIntent(current, status);
    }
    expect(current).toMatchObject({ status: 'completed', version: 7 });
  });

  it('rejects skipped validation, duplicate completion, missing decision, and completed mutation', () => {
    expect(() => transitionBookingIntent(intent(), 'submitting')).toThrow(/invalid transition/i);
    expect(() => transitionBookingIntent(intent(), 'validating')).toThrow(/invalid transition/i);
    let current = intent();
    current = transitionBookingIntent(current, 'awaiting_user_decision');
    current = transitionBookingIntent(current, 'validating');
    current = transitionBookingIntent(current, 'awaiting_traveler_data_grant');
    current = transitionBookingIntent(current, 'submitting');
    current = transitionBookingIntent(current, 'awaiting_supplier');
    current = transitionBookingIntent(current, 'completed');
    expect(() => transitionBookingIntent(current, 'completed')).toThrow(/invalid transition/i);
    expect(() => transitionBookingIntent(current, 'cancelling')).toThrow(/completed/i);
  });

  it('supports failure, expiry, and cancellation only from allowed states', () => {
    let current = intent();
    current = transitionBookingIntent(current, 'awaiting_user_decision');
    current = transitionBookingIntent(current, 'expired');
    expect(current.status).toBe('expired');
    expect(() => transitionBookingIntent(current, 'validating')).toThrow(/invalid transition/i);
    current = intent();
    current = transitionBookingIntent(current, 'awaiting_user_decision');
    current = transitionBookingIntent(current, 'validating');
    current = transitionBookingIntent(current, 'failed');
    expect(current.status).toBe('failed');
  });
});
