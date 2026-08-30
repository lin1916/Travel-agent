import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('agent_runs')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('actor_id', 'varchar(128)')
    .addColumn('status', 'varchar(32)', col => col.notNull().defaultTo('running'))
    .addColumn('user_message', 'text', col => col.notNull().defaultTo(''))
    .addColumn('assistant_message', 'text', col => col.notNull().defaultTo(''))
    .addColumn('missing_fields_json', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('tool_calls_json', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('action_requests_json', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('next_step', 'varchar(128)')
    .addColumn('current_trip_version', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('updated_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();
  await db.schema.createIndex('agent_runs_trip_idx').ifNotExists().on('agent_runs').columns(['trip_id', 'updated_at']).execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('agent_runs').ifExists().execute();
}
