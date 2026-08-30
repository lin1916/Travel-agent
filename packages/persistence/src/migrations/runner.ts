import type { Kysely } from 'kysely';
import { up as upCore } from '../../migrations/001_core.js';
import { up as upItineraryBudget } from '../../migrations/002_itinerary_budget.js';
import { up as upOffers } from '../../migrations/003_offers.js';
import { up as upAgentRuns } from '../../migrations/004_agent_runs.js';
import { up as upAgentRunSummaries } from '../../migrations/005_agent_run_summaries.js';
import { up as upVaultRefs } from '../../migrations/006_vault_refs.js';
import type { Database } from '../types.js';

type Migration = { name: string; up: (db: Kysely<Database>) => Promise<void> };

export const migrations: Migration[] = [
  { name: '001_core', up: upCore },
  { name: '002_itinerary_budget', up: upItineraryBudget },
  { name: '003_offers', up: upOffers },
  { name: '004_agent_runs', up: upAgentRuns },
  { name: '005_agent_run_summaries', up: upAgentRunSummaries },
  { name: '006_vault_refs', up: upVaultRefs },
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
