import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('trips')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('owner_id', 'varchar(128)', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull().defaultTo(1))
    .addColumn('destination', 'varchar(256)', col => col.notNull())
    .addColumn('starts_at', 'timestamptz', col => col.notNull())
    .addColumn('ends_at', 'timestamptz', col => col.notNull())
    .addColumn('traveler_count', 'integer', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('updated_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();

  await db.schema.createIndex('trips_owner_id_idx').ifNotExists().on('trips').column('owner_id').execute();

  await db.schema
    .createTable('idempotency_keys')
    .ifNotExists()
    .addColumn('scope', 'varchar(256)', col => col.notNull())
    .addColumn('key', 'varchar(256)', col => col.notNull())
    .addColumn('request_hash', 'varchar(128)', col => col.notNull())
    .addColumn('status', 'varchar(32)', col => col.notNull())
    .addColumn('response_json', 'text')
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('expires_at', 'timestamptz')
    .addPrimaryKeyConstraint('idempotency_keys_pk', ['scope', 'key'])
    .execute();

  await db.schema
    .createTable('tasks')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('kind', 'varchar(64)', col => col.notNull())
    .addColumn('status', 'varchar(32)', col => col.notNull().defaultTo('pending'))
    .addColumn('payload_json', 'text', col => col.notNull())
    .addColumn('attempts', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('available_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('lease_owner', 'varchar(128)')
    .addColumn('lease_until', 'timestamptz')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('updated_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();
  await db.schema.createIndex('tasks_ready_idx').ifNotExists().on('tasks').columns(['status', 'available_at']).execute();

  await db.schema
    .createTable('outbox_events')
    .ifNotExists()
    .addColumn('id', 'bigserial', col => col.primaryKey())
    .addColumn('event_id', 'varchar(128)', col => col.notNull().unique())
    .addColumn('aggregate_type', 'varchar(128)', col => col.notNull())
    .addColumn('aggregate_id', 'varchar(128)', col => col.notNull())
    .addColumn('sequence', 'integer', col => col.notNull())
    .addColumn('event_type', 'varchar(128)', col => col.notNull())
    .addColumn('payload_json', 'text', col => col.notNull())
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addUniqueConstraint('outbox_aggregate_sequence_uq', ['aggregate_type', 'aggregate_id', 'sequence'])
    .execute();

  await db.schema
    .createTable('inbox_messages')
    .ifNotExists()
    .addColumn('consumer_name', 'varchar(128)', col => col.notNull())
    .addColumn('event_id', 'varchar(128)', col => col.notNull())
    .addColumn('external_event_id', 'varchar(256)')
    .addColumn('processed_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addPrimaryKeyConstraint('inbox_messages_pk', ['consumer_name', 'event_id'])
    .execute();
  await db.schema.createIndex('inbox_external_event_idx').ifNotExists().on('inbox_messages').columns(['consumer_name', 'external_event_id']).unique().execute();

  await db.schema
    .createTable('event_log')
    .ifNotExists()
    .addColumn('event_id', 'varchar(128)', col => col.primaryKey())
    .addColumn('event_type', 'varchar(128)', col => col.notNull())
    .addColumn('aggregate_type', 'varchar(128)', col => col.notNull())
    .addColumn('aggregate_id', 'varchar(128)', col => col.notNull())
    .addColumn('run_id', 'varchar(128)')
    .addColumn('sequence', 'integer', col => col.notNull())
    .addColumn('schema_version', 'integer', col => col.notNull())
    .addColumn('occurred_at', 'timestamptz', col => col.notNull())
    .addColumn('request_id', 'varchar(128)', col => col.notNull())
    .addColumn('correlation_id', 'varchar(128)', col => col.notNull())
    .addColumn('payload_json', 'text', col => col.notNull())
    .addUniqueConstraint('event_aggregate_sequence_uq', ['aggregate_type', 'aggregate_id', 'sequence'])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  for (const table of ['event_log', 'inbox_messages', 'outbox_events', 'tasks', 'idempotency_keys', 'trips'] as const) {
    await db.schema.dropTable(table).ifExists().execute();
  }
  await db.schema.dropTable('schema_migrations').ifExists().execute();
}
