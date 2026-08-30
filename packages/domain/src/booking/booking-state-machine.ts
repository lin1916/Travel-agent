import type { BookingIntentStatus } from '@travel/contracts';

const transitions: Record<BookingIntentStatus, readonly BookingIntentStatus[]> = {
  draft: ['awaiting_user_decision', 'expired'],
  awaiting_user_decision: ['validating', 'expired'],
  validating: ['awaiting_traveler_data_grant', 'failed', 'expired'],
  awaiting_traveler_data_grant: ['submitting', 'failed', 'expired'],
  submitting: ['awaiting_supplier', 'failed', 'expired'],
  awaiting_supplier: ['completed', 'failed', 'expired', 'cancelling'],
  completed: [], failed: [], expired: [],
  cancelling: ['cancelled', 'failed'], cancelled: [],
};

export function canTransitionBookingIntent(from: BookingIntentStatus, to: BookingIntentStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function assertBookingIntentTransition(from: BookingIntentStatus, to: BookingIntentStatus): void {
  if (!canTransitionBookingIntent(from, to)) throw new Error(`invalid transition from ${from} to ${to}`);
}
