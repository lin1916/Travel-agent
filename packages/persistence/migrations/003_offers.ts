import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('offers')
    .ifNotExists()
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('offer_id', 'varchar(128)', col => col.notNull())
    .addColumn('kind', 'varchar(32)', col => col.notNull())
    .addColumn('supplier_id', 'varchar(128)', col => col.notNull())
    .addColumn('snapshot_hash', 'varchar(128)', col => col.notNull())
    .addColumn('source', 'varchar(128)', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addColumn('payload_json', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addPrimaryKeyConstraint('offers_pk', ['trip_id', 'offer_id'])
    .execute();
  await db.schema.createIndex('offers_trip_kind_idx').ifNotExists().on('offers').columns(['trip_id', 'kind']).execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('offers').ifExists().execute();
}
