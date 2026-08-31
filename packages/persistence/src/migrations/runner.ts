import type { Kysely } from 'kysely';
import { up as upCore } from '../../migrations/001_core.js';
import { up as upItineraryBudget } from '../../migrations/002_itinerary_budget.js';
import { up as upOffers } from '../../migrations/003_offers.js';
import { up as upAgentRuns } from '../../migrations/004_agent_runs.js';
import { up as upAgentRunSummaries } from '../../migrations/005_agent_run_summaries.js';
import { up as upVaultRefs } from '../../migrations/006_vault_refs.js';
import { up as upMandatesActions } from '../../migrations/007_mandates_actions.js';
import { up as upActionRequestConsumedAt } from '../../migrations/008_action_request_consumed_at.js';
import { up as upBookingsOrders } from '../../migrations/009_bookings_orders.js';
import { up as upWebhooksReconciliation } from '../../migrations/010_webhooks_reconciliation.js';
import { up as upInboxDeliveryClaims } from '../../migrations/011_inbox_delivery_claims.js';
import { up as upAfterSales } from '../../migrations/012_after_sales.js';
import { up as upAudit } from '../../migrations/013_audit.js';
import type { Database } from '../types.js';

type Migration = { name: string; up: (db: Kysely<Database>) => Promise<void> };

export const migrations: Migration[] = [
  { name: '001_core', up: upCore },
  { name: '002_itinerary_budget', up: upItineraryBudget },
  { name: '003_offers', up: upOffers },
  { name: '004_agent_runs', up: upAgentRuns },
  { name: '005_agent_run_summaries', up: upAgentRunSummaries },
  { name: '006_vault_refs', up: upVaultRefs },
  { name: '007_mandates_actions', up: upMandatesActions },
  { name: '008_action_request_consumed_at', up: upActionRequestConsumedAt },
  { name: '009_bookings_orders', up: upBookingsOrders },
  { name: '010_webhooks_reconciliation', up: upWebhooksReconciliation },
  { name: '011_inbox_delivery_claims', up: upInboxDeliveryClaims },
  { name: '012_after_sales', up: upAfterSales },
  { name: '013_audit', up: upAudit },
];

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('schema_migrations')
    .ifNotExists()
    .addColumn('name', 'varchar(128)', col => col.primaryKey())
    .addColumn('applied_at', 'timestamptz', col => col.notNull())
    .execute();

  for (const migration of migrations) {
    const applied = await db
      .selectFrom('schema_migrations')
      .select('name')
      .where('name', '=', migration.name)
      .executeTakeFirst();
    if (applied) {
      continue;
    }

    await db.transaction().execute(async tx => {
      await migration.up(tx);
      await tx
        .insertInto('schema_migrations')
        .values({ name: migration.name, applied_at: new Date().toISOString() })
        .onConflict(oc => oc.column('name').doNothing())
        .execute();
    });
  }
}

