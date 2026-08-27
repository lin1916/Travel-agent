import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('itinerary_items')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('version', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('category', 'varchar(32)', col => col.notNull())
    .addColumn('starts_at', 'timestamptz', col => col.notNull())
    .addColumn('ends_at', 'timestamptz', col => col.notNull())
    .addColumn('location_json', 'text')
    .addColumn('offer_id', 'varchar(128)')
    .addColumn('supplier_order_id', 'varchar(128)')
    .addColumn('confirmed', 'boolean', col => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createTable('budget_ledgers')
    .ifNotExists()
    .addColumn('trip_id', 'varchar(128)', col => col.primaryKey().references('trips.id').onDelete('cascade'))
    .addColumn('total_limit_cents', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('category_limits_json', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('estimated_cents', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('reserved_cents', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('committed_cents', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('paid_cents', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('released_cents', 'bigint', col => col.notNull().defaultTo(0))
    .addColumn('category_paid_json', 'text', col => col.notNull().defaultTo('{}'))
    .addColumn('updated_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();

  await db.schema
    .createTable('budget_delta_keys')
    .ifNotExists()
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('idempotency_key', 'varchar(256)', col => col.notNull())
    .addColumn('applied_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addPrimaryKeyConstraint('budget_delta_keys_pk', ['trip_id', 'idempotency_key'])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  for (const table of ['budget_delta_keys', 'budget_ledgers', 'itinerary_items'] as const) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
