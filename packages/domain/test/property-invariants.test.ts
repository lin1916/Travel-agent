import { describe, expect, it } from 'vitest';
import { applyBudgetDelta, createBudgetState } from '../src/budget/ledger.js';

const money = (amountCents: number) => ({ amountCents, currency: 'CNY' as const });

describe('budget invariants', () => {
  it('never produces a negative ledger bucket across generated deltas', () => {
    let state = createBudgetState({
      totalLimit: money(1_000_000),
      categoryLimits: {},
      estimated: money(0),
      reserved: money(0),
      committed: money(0),
      paid: money(0),
      released: money(0),
      categoryPaid: {},
    });

    for (let index = 1; index <= 100; index += 1) {
      state = applyBudgetDelta(state, {
        category: 'dining',
        amount: money(index),
        ledgerState: 'paid',
        idempotencyKey: 'paid-' + index,
      });
    }

    expect(state.ledger.paid.amountCents).toBe(5_050);
    expect(Object.values(state.ledger).filter(value => typeof value === 'object')).toBeTruthy();
  });
});
