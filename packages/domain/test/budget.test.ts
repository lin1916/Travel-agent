import { describe, expect, it } from 'vitest';
import type { BudgetLedger } from '@travel/contracts';
import { applyBudgetDelta, createBudgetState, evaluateBudget, transitionBudgetAmount } from '../src/budget/ledger.js';

const money = (amountCents: number) => ({ amountCents, currency: 'CNY' as const });

function ledger(): BudgetLedger {
  return {
    totalLimit: money(100_000),
    categoryLimits: { transport: money(60_000) },
    estimated: money(0),
    reserved: money(0),
    committed: money(0),
    paid: money(0),
    released: money(0),
    categoryPaid: {},
  };
}

describe('budget policy', () => {
  it('warns at 80 percent and blocks over 100 percent', () => {
    const warning = evaluateBudget(ledger(), {
      category: 'transport',
      amount: money(80_000),
      ledgerState: 'reserved',
      idempotencyKey: 'reserve-1',
    });
    expect(warning.warning).toBe(true);
    expect(warning.blocked).toBe(true);

    const totalOnly = { ...ledger(), categoryLimits: {} };
    const allowedWarning = evaluateBudget(totalOnly, {
      category: 'stay',
      amount: money(80_000),
      ledgerState: 'reserved',
      idempotencyKey: 'reserve-2',
    });
    expect(allowedWarning).toMatchObject({ allowed: true, warning: true, blocked: false });

    const blocked = evaluateBudget(totalOnly, {
      category: 'stay',
      amount: money(100_001),
      ledgerState: 'reserved',
      idempotencyKey: 'reserve-3',
    });
    expect(blocked).toMatchObject({ allowed: false, blocked: true });
  });

  it('requires a decision reference for an over-budget override', () => {
    const result = evaluateBudget(
      ledger(),
      {
        category: 'transport',
        amount: money(60_001),
        ledgerState: 'reserved',
        idempotencyKey: 'reserve-4',
      },
      { override: true, decisionRef: 'decision-1' },
    );
    expect(result.allowed).toBe(true);
    expect(result.reasons).toContain('budget_override:decision-1');
  });

  it('applies the same delta once', () => {
    const state = createBudgetState(ledger());
    const delta = {
      category: 'stay' as const,
      amount: money(10_000),
      ledgerState: 'reserved' as const,
      idempotencyKey: 'reserve-once',
    };
    const once = applyBudgetDelta(state, delta);
    const twice = applyBudgetDelta(once, delta);
    expect(twice.ledger.reserved.amountCents).toBe(10_000);
  });

  it('rejects releasing more than the current exposure', () => {
    const state = createBudgetState(ledger());
    expect(() =>
      applyBudgetDelta(state, {
        category: 'stay',
        amount: money(1),
        ledgerState: 'released',
        idempotencyKey: 'invalid-release',
      }),
    ).toThrow('released amount exceeds current exposure');
  });

  it('rejects a release from a category that has no prior exposure', () => {
    const reserved = applyBudgetDelta(createBudgetState(ledger()), {
      category: 'transport',
      amount: money(10_000),
      ledgerState: 'reserved',
      idempotencyKey: 'transport-reserve',
    });
    expect(() =>
      applyBudgetDelta(reserved, {
        category: 'stay',
        amount: money(10_000),
        ledgerState: 'released',
        idempotencyKey: 'stay-release',
      }),
    ).toThrow('released amount exceeds category exposure');
  });

  it('uses integer threshold checks for large CNY cent amounts', () => {
    const largeLedger = {
      ...ledger(),
      totalLimit: money(9_007_199_254_740_990),
      categoryLimits: {},
    };
    expect(evaluateBudget(largeLedger, {
      category: 'stay',
      amount: money(7_205_759_403_792_791),
      ledgerState: 'reserved',
      idempotencyKey: 'large-threshold',
    }).warning).toBe(false);
  });

  it('rejects transition release when category exposure does not match', () => {
    const state = applyBudgetDelta(createBudgetState(ledger()), {
      category: 'transport', amount: money(5_000), ledgerState: 'reserved', idempotencyKey: 'r1',
    });
    expect(() => transitionBudgetAmount(state, 'stay', 'reserved', 'released', 5_000, 'r2'))
      .toThrow('release category exposure');
  });
});
