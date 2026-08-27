import type {
  BudgetDecision,
  BudgetDelta,
  BudgetLedger,
  Money,
  TravelCategory,
} from '@travel/contracts';
import { validOverride, type BudgetOverride } from './policy.js';

export interface BudgetState {
  ledger: BudgetLedger;
  appliedKeys: ReadonlySet<string>;
}

const money = (amountCents: number): Money => ({ amountCents, currency: 'CNY' });

function exposure(ledger: BudgetLedger): number {
  return Math.max(
    0,
    ledger.estimated.amountCents
      + ledger.reserved.amountCents
      + ledger.committed.amountCents
      + ledger.paid.amountCents
      - ledger.released.amountCents,
  );
}

function deltaSign(delta: BudgetDelta): number {
  return delta.ledgerState === 'released' ? -1 : 1;
}

export function evaluateBudget(
  ledger: BudgetLedger,
  delta: BudgetDelta,
  override?: BudgetOverride,
): BudgetDecision {
  const totalAfterCents = Math.max(0, exposure(ledger) + deltaSign(delta) * delta.amount.amountCents);
  const categoryCurrent = ledger.categoryPaid[delta.category]?.amountCents ?? 0;
  const categoryAfterCents = Math.max(
    0,
    categoryCurrent + deltaSign(delta) * delta.amount.amountCents,
  );
  const categoryLimit = ledger.categoryLimits[delta.category]?.amountCents;
  const totalRatio = ledger.totalLimit.amountCents === 0
    ? Number.POSITIVE_INFINITY
    : totalAfterCents / ledger.totalLimit.amountCents;
  const categoryRatio = categoryLimit === undefined
    ? 0
    : categoryLimit === 0
      ? Number.POSITIVE_INFINITY
      : categoryAfterCents / categoryLimit;
  const exceeds = totalAfterCents > ledger.totalLimit.amountCents
    || (categoryLimit !== undefined && categoryAfterCents > categoryLimit);
  const reasons: string[] = [];
  if (totalRatio >= 0.8) reasons.push('total_budget_threshold');
  if (categoryRatio >= 0.8) reasons.push('category_budget_threshold');
  if (exceeds) reasons.push('budget_exceeded');
  if (exceeds && validOverride(override)) reasons.push('budget_override:' + override.decisionRef);

  return {
    allowed: !exceeds || validOverride(override),
    warning: totalRatio >= 0.8 || categoryRatio >= 0.8,
    blocked: exceeds && !validOverride(override),
    totalAfter: money(totalAfterCents),
    categoryAfter: money(categoryAfterCents),
    reasons,
  };
}

export function createBudgetState(ledger: BudgetLedger): BudgetState {
  return {
    ledger: structuredClone(ledger),
    appliedKeys: new Set(),
  };
}

export function applyBudgetDelta(state: BudgetState, delta: BudgetDelta): BudgetState {
  if (state.appliedKeys.has(delta.idempotencyKey)) {
    return state;
  }
  if (delta.ledgerState === 'released' && delta.amount.amountCents > exposure(state.ledger)) {
    throw new Error('released amount exceeds current exposure');
  }

  const nextLedger = structuredClone(state.ledger);
  const bucket = nextLedger[delta.ledgerState];
  bucket.amountCents += delta.amount.amountCents;
  const currentCategory = nextLedger.categoryPaid[delta.category]?.amountCents ?? 0;
  nextLedger.categoryPaid[delta.category] = money(Math.max(
    0,
    currentCategory + deltaSign(delta) * delta.amount.amountCents,
  ));
  return {
    ledger: nextLedger,
    appliedKeys: new Set([...state.appliedKeys, delta.idempotencyKey]),
  };
}

export function createEmptyLedger(
  totalLimitCents: number,
  categoryLimits: Partial<Record<TravelCategory, Money>> = {},
): BudgetLedger {
  return {
    totalLimit: money(totalLimitCents),
    categoryLimits,
    estimated: money(0),
    reserved: money(0),
    committed: money(0),
    paid: money(0),
    released: money(0),
    categoryPaid: {},
  };
}
