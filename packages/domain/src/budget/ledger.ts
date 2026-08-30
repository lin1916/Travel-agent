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
  const totalAtWarningThreshold = ledger.totalLimit.amountCents === 0
    ? totalAfterCents > 0
    : BigInt(totalAfterCents) * 100n >= BigInt(ledger.totalLimit.amountCents) * 80n;
  const categoryAtWarningThreshold = categoryLimit === undefined
    ? false
    : categoryLimit === 0
      ? categoryAfterCents > 0
      : BigInt(categoryAfterCents) * 100n >= BigInt(categoryLimit) * 80n;
  const exceeds = totalAfterCents > ledger.totalLimit.amountCents
    || (categoryLimit !== undefined && categoryAfterCents > categoryLimit);
  const reasons: string[] = [];
  if (totalAtWarningThreshold) reasons.push('total_budget_threshold');
  if (categoryAtWarningThreshold) reasons.push('category_budget_threshold');
  if (exceeds) reasons.push('budget_exceeded');
  if (exceeds && validOverride(override)) reasons.push('budget_override:' + override.decisionRef);

  return {
    allowed: !exceeds || validOverride(override),
    warning: totalAtWarningThreshold || categoryAtWarningThreshold,
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
  if (delta.ledgerState === 'released') {
    if (delta.amount.amountCents > exposure(state.ledger)) {
      throw new Error('released amount exceeds current exposure');
    }
    const categoryExposure = state.ledger.categoryPaid[delta.category]?.amountCents ?? 0;
    if (delta.amount.amountCents > categoryExposure) {
      throw new Error('released amount exceeds category exposure');
    }
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

type ActiveBudgetBucket = 'estimated' | 'reserved' | 'committed' | 'paid';

export function transitionBudgetAmount(
  state: BudgetState,
  category: TravelCategory,
  from: ActiveBudgetBucket,
  to: ActiveBudgetBucket | 'released',
  amountCents: number,
  idempotencyKey: string,
): BudgetState {
  if (state.appliedKeys.has(idempotencyKey)) {
    return state;
  }
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('transition amount must be a non-negative integer');
  }
  if (state.ledger[from].amountCents < amountCents) {
    throw new Error('transition amount exceeds source bucket');
  }

  const nextLedger = structuredClone(state.ledger);
  nextLedger[from].amountCents -= amountCents;
  nextLedger[to].amountCents += amountCents;
  if (to === 'released') {
    const categoryExposure = nextLedger.categoryPaid[category]?.amountCents ?? 0;
    nextLedger.categoryPaid[category] = money(Math.max(0, categoryExposure - amountCents));
  }
  return {
    ledger: nextLedger,
    appliedKeys: new Set([...state.appliedKeys, idempotencyKey]),
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
