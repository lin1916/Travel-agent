import type { BudgetDelta, BudgetLedger, TravelCategory } from '@travel/contracts';
import {
  applyBudgetDelta,
  createBudgetState,
  createEmptyLedger,
  evaluateBudget,
  type BudgetOverride,
  type BudgetState,
} from '@travel/domain';

export class BudgetService {
  private readonly budgets = new Map<string, BudgetState>();

  initialize(
    tripId: string,
    totalLimitCents: number,
    categoryLimits: Partial<Record<TravelCategory, { amountCents: number; currency: 'CNY' }>> = {},
  ): BudgetLedger {
    const state = createBudgetState(createEmptyLedger(totalLimitCents, categoryLimits));
    this.budgets.set(tripId, state);
    return structuredClone(state.ledger);
  }

  get(tripId: string): BudgetLedger {
    const state = this.budgets.get(tripId);
    if (!state) {
      return this.initialize(tripId, 0);
    }
    return structuredClone(state.ledger);
  }

  apply(tripId: string, delta: BudgetDelta, override?: BudgetOverride): BudgetLedger {
    const current = this.budgets.get(tripId) ?? createBudgetState(createEmptyLedger(0));
    const decision = evaluateBudget(current.ledger, delta, override);
    if (!decision.allowed) {
      throw new Error('budget policy blocked this delta');
    }
    const next = applyBudgetDelta(current, delta);
    this.budgets.set(tripId, next);
    return structuredClone(next.ledger);
  }
}
