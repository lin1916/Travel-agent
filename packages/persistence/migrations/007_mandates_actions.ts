import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.createTable('mandates').ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('trip_id', 'varchar(128)', col => col.notNull())
    .addColumn('owner_id', 'varchar(128)', col => col.notNull())
    .addColumn('payload_json', 'text', col => col.notNull())
    .addColumn('policy_hash', 'varchar(128)', col => col.notNull())
    .addColumn('actor_id', 'varchar(128)', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('valid_until', 'timestamptz', col => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addPrimaryKeyConstraint('mandates_pk', ['id', 'version'])
    .execute();
  await db.schema.createTable('action_requests').ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('trip_id', 'varchar(128)', col => col.notNull())
    .addColumn('owner_id', 'varchar(128)', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('status', 'varchar(32)', col => col.notNull())
    .addColumn('payload_json', 'text', col => col.notNull())
    .addColumn('request_hash', 'varchar(128)', col => col.notNull())
    .addColumn('policy_snapshot_json', 'text')
    .addColumn('decision_actor_id', 'varchar(128)')
    .addColumn('decision_reason', 'text')
    .addColumn('correlation_id', 'varchar(128)', col => col.notNull())
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('action_requests').ifExists().execute();
  await db.schema.dropTable('mandates').ifExists().execute();
}
