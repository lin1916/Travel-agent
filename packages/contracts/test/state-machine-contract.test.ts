import { describe, expect, it } from 'vitest';
import { BookingIntentStatusSchema, SupplierOrderLifecycleSchema } from '../src/index.js';

describe('state machine contracts', () => {
  it('accepts distinct BookingIntent statuses', () => {
    expect(BookingIntentStatusSchema.parse('awaiting_user_decision')).toBe('awaiting_user_decision');
    expect(BookingIntentStatusSchema.safeParse('confirmed').success).toBe(false);
  });

  it('accepts separate supplier order lifecycle statuses', () => {
    expect(SupplierOrderLifecycleSchema.parse('creation_unknown')).toBe('creation_unknown');
    expect(SupplierOrderLifecycleSchema.safeParse('completed').success).toBe(false);
  });
});
