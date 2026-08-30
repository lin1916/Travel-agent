import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('traveler_vault_refs')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('owner_id', 'varchar(128)', col => col.notNull())
    .addColumn('vault_traveler_id', 'varchar(128)', col => col.notNull().unique())
    .addColumn('field_names_json', 'text', col => col.notNull())
    .addColumn('retention_until', 'timestamptz', col => col.notNull())
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('updated_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();
  await db.schema
    .createIndex('traveler_vault_refs_owner_idx')
    .ifNotExists()
    .on('traveler_vault_refs')
    .column('owner_id')
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('traveler_vault_refs').ifExists().execute();
}
