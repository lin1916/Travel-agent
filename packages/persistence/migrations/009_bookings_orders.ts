import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.createTable('booking_intents').ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('owner_id', 'varchar(128)', col => col.notNull())
    .addColumn('offer_id', 'varchar(128)', col => col.notNull())
    .addColumn('offer_kind', 'varchar(32)', col => col.notNull())
    .addColumn('status', 'varchar(64)', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('payload_json', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('updated_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();
  await db.schema.createTable('supplier_orders').ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('intent_id', 'varchar(128)', col => col.notNull().references('booking_intents.id').onDelete('cascade'))
    .addColumn('supplier_id', 'varchar(128)', col => col.notNull())
    .addColumn('lifecycle_status', 'varchar(64)', col => col.notNull())
    .addColumn('reconciliation_status', 'varchar(64)', col => col.notNull())
    .addColumn('payload_json', 'text', col => col.notNull())
    .addColumn('external_idempotency_key', 'varchar(256)', col => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('supplier_orders').ifExists().execute();
  await db.schema.dropTable('booking_intents').ifExists().execute();
}
