import { describe, expect, it } from 'vitest';
import {
  applyBudgetDelta,
  createBudgetState,
  transitionBudgetAmount,
} from '../src/budget/ledger.js';

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
    expect([
      state.ledger.estimated,
      state.ledger.reserved,
      state.ledger.committed,
      state.ledger.paid,
      state.ledger.released,
    ].every(value => value.amountCents >= 0)).toBe(true);
  });

  it('conserves exposure while amounts move through booking states', () => {
    let state = createBudgetState({
      totalLimit: money(100_000),
      categoryLimits: {},
      estimated: money(0),
      reserved: money(0),
      committed: money(0),
      paid: money(0),
      released: money(0),
      categoryPaid: {},
    });
    state = applyBudgetDelta(state, {
      category: 'transport',
      amount: money(10_000),
      ledgerState: 'reserved',
      idempotencyKey: 'reserve',
    });
    state = transitionBudgetAmount(state, 'transport', 'reserved', 'committed', 10_000, 'commit');
    state = transitionBudgetAmount(state, 'transport', 'committed', 'paid', 10_000, 'pay');
    state = transitionBudgetAmount(state, 'transport', 'paid', 'released', 10_000, 'refund');

    expect(state.ledger).toMatchObject({
      reserved: money(0),
      committed: money(0),
      paid: money(0),
      released: money(10_000),
    });
    expect(state.ledger.categoryPaid.transport).toEqual(money(0));
  });
});
