import type { BudgetLedger, TravelCategory } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

const money = (amountCents: number) => ({ amountCents, currency: 'CNY' as const });

function toLedger(row: any): BudgetLedger {
  return {
    totalLimit: money(Number(row.total_limit_cents)),
    categoryLimits: JSON.parse(row.category_limits_json),
    estimated: money(Number(row.estimated_cents)), reserved: money(Number(row.reserved_cents)),
    committed: money(Number(row.committed_cents)), paid: money(Number(row.paid_cents)), released: money(Number(row.released_cents)),
    categoryPaid: JSON.parse(row.category_paid_json),
  };
}

export class BudgetRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async initialize(tripId: string, totalLimitCents: number, categoryLimits: Partial<Record<TravelCategory, { amountCents: number; currency: 'CNY' }>> = {}, tx?: DatabaseTransaction): Promise<BudgetLedger> {
    const row = await (tx ?? this.db).insertInto('budget_ledgers').values({
      trip_id: tripId, total_limit_cents: totalLimitCents, category_limits_json: JSON.stringify(categoryLimits),
      estimated_cents: 0, reserved_cents: 0, committed_cents: 0, paid_cents: 0, released_cents: 0, category_paid_json: '{}', updated_at: new Date().toISOString(),
    }).onConflict(oc => oc.column('trip_id').doNothing()).returningAll().executeTakeFirst();
    return row ? toLedger(row) : (await this.get(tripId, tx))!;
  }
  async get(tripId: string, tx?: DatabaseTransaction): Promise<BudgetLedger | null> {
    const row = await (tx ?? this.db).selectFrom('budget_ledgers').selectAll().where('trip_id', '=', tripId).executeTakeFirst();
    return row ? toLedger(row) : null;
  }
}
