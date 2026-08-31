import type { BudgetDelta, BudgetLedger, TravelCategory } from '@travel/contracts';
import {
  applyBudgetDelta,
  createBudgetState,
  createEmptyLedger,
  evaluateBudget,
  transitionBudgetAmount,
  type BudgetOverride,
  type BudgetState,
} from '@travel/domain';
import type { BudgetRepository } from '@travel/persistence';

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

  reserve(tripId: string, category: TravelCategory, amountCents: number, idempotencyKey: string): BudgetLedger {
    const state = this.budgets.get(tripId) ?? createBudgetState(createEmptyLedger(0));
    if (state.appliedKeys.has(idempotencyKey)) return structuredClone(state.ledger);
    const next = applyBudgetDelta(state, { category, amount: { amountCents, currency: 'CNY' }, ledgerState: 'reserved', idempotencyKey });
    this.budgets.set(tripId, next);
    return structuredClone(next.ledger);
  }

  settlePaid(tripId: string, category: TravelCategory, amountCents: number, idempotencyKey: string): BudgetLedger {
    const state = this.budgets.get(tripId) ?? createBudgetState(createEmptyLedger(0));
    if (state.appliedKeys.has(idempotencyKey)) return structuredClone(state.ledger);
    const committed = transitionBudgetAmount(state, category, 'reserved', 'committed', amountCents, `${idempotencyKey}:commit`);
    const paid = transitionBudgetAmount(committed, category, 'committed', 'paid', amountCents, `${idempotencyKey}:paid`);
    this.budgets.set(tripId, paid);
    return structuredClone(paid.ledger);
  }

  release(tripId: string, category: TravelCategory, amountCents: number, idempotencyKey: string): BudgetLedger {
    return this.transition(tripId, category, 'paid', 'released', amountCents, idempotencyKey);
  }

  private transition(tripId: string, category: TravelCategory, from: 'estimated' | 'reserved' | 'committed' | 'paid', to: 'reserved' | 'released', amountCents: number, idempotencyKey: string): BudgetLedger {
    const state = this.budgets.get(tripId) ?? createBudgetState(createEmptyLedger(0));
    const next = transitionBudgetAmount(state, category, from, to, amountCents, idempotencyKey);
    this.budgets.set(tripId, next);
    return structuredClone(next.ledger);
  }
}

export class PersistentBudgetService {
  constructor(private readonly store: BudgetRepository) {}
  async get(tripId: string): Promise<BudgetLedger> {
    const ledger = await this.store.get(tripId);
    if (!ledger) throw new Error('budget not initialized');
    return ledger;
  }
}
