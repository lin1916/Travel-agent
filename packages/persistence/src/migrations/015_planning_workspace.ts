import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('anonymous_sessions')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addColumn('updated_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();
  await db.schema.createIndex('anonymous_sessions_expiry_idx').ifNotExists().on('anonymous_sessions').column('expires_at').execute();

  await db.schema
    .createTable('agent_conversations')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('session_id', 'varchar(128)', col => col.notNull().references('anonymous_sessions.id').onDelete('cascade'))
    .addColumn('provider_name', 'varchar(128)', col => col.notNull())
    .addColumn('model', 'varchar(128)', col => col.notNull())
    .addColumn('status', 'varchar(32)', col => col.notNull())
    .addColumn('trip_id', 'varchar(128)', col => col.references('trips.id').onDelete('set null'))
    .addColumn('agent_run_id', 'varchar(128)')
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .execute();
  await db.schema.createIndex('agent_conversations_session_idx').ifNotExists().on('agent_conversations').column('session_id').execute();
  await db.schema.createIndex('agent_conversations_expiry_idx').ifNotExists().on('agent_conversations').column('expires_at').execute();

  await db.schema
    .createTable('agent_messages')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('conversation_id', 'varchar(128)', col => col.notNull().references('agent_conversations.id').onDelete('cascade'))
    .addColumn('sequence', 'integer', col => col.notNull())
    .addColumn('role', 'varchar(32)', col => col.notNull())
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addUniqueConstraint('agent_messages_conversation_sequence_uq', ['conversation_id', 'sequence'])
    .execute();
  await db.schema.createIndex('agent_messages_order_idx').ifNotExists().on('agent_messages').columns(['conversation_id', 'sequence']).execute();

  await db.schema
    .createTable('plan_versions')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('owner_id', 'varchar(128)', col => col.notNull().references('anonymous_sessions.id').onDelete('cascade'))
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('items_json', 'text', col => col.notNull())
    .addColumn('warnings_json', 'text', col => col.notNull())
    .addColumn('budget_json', 'text', col => col.notNull())
    .addUniqueConstraint('plan_versions_trip_owner_version_uq', ['trip_id', 'owner_id', 'version'])
    .execute();
  await db.schema.createIndex('plan_versions_current_idx').ifNotExists().on('plan_versions').columns(['trip_id', 'owner_id', 'version']).execute();

  await db.schema
    .createTable('plan_change_sets')
    .ifNotExists()
    .addColumn('plan_version_id', 'varchar(128)', col => col.primaryKey().references('plan_versions.id').onDelete('cascade'))
    .addColumn('command', 'varchar(32)', col => col.notNull())
    .addColumn('summary', 'text', col => col.notNull())
    .addColumn('changed_item_ids_json', 'text', col => col.notNull())
    .execute();

  await db.schema
    .createTable('places')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('owner_id', 'varchar(128)', col => col.notNull().references('anonymous_sessions.id').onDelete('cascade'))
    .addColumn('name', 'varchar(256)', col => col.notNull())
    .addColumn('category', 'varchar(128)', col => col.notNull())
    .addColumn('address', 'text', col => col.notNull())
    .addColumn('city', 'varchar(128)', col => col.notNull())
    .addColumn('latitude', 'double precision', col => col.notNull())
    .addColumn('longitude', 'double precision', col => col.notNull())
    .addColumn('provider_place_id', 'varchar(256)', col => col.notNull())
    .addColumn('source_updated_at', 'timestamptz', col => col.notNull())
    .addUniqueConstraint('places_trip_owner_provider_uq', ['trip_id', 'owner_id', 'provider_place_id'])
    .execute();
  await db.schema.createIndex('places_trip_owner_idx').ifNotExists().on('places').columns(['trip_id', 'owner_id']).execute();

  await db.schema
    .createTable('route_plans')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('owner_id', 'varchar(128)', col => col.notNull().references('anonymous_sessions.id').onDelete('cascade'))
    .addColumn('origin_place_id', 'varchar(128)', col => col.notNull())
    .addColumn('destination_place_id', 'varchar(128)', col => col.notNull())
    .addColumn('mode', 'varchar(32)', col => col.notNull())
    .addColumn('status', 'varchar(32)', col => col.notNull())
    .addColumn('origin_json', 'text', col => col.notNull())
    .addColumn('destination_json', 'text', col => col.notNull())
    .addColumn('distance_meters', 'double precision')
    .addColumn('duration_minutes', 'double precision')
    .addColumn('polyline', 'text')
    .addColumn('estimated_cost_cents', 'integer')
    .addColumn('reason', 'text')
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addUniqueConstraint('route_plans_trip_owner_key_uq', ['trip_id', 'owner_id', 'origin_place_id', 'destination_place_id', 'mode'])
    .execute();
  await db.schema.createIndex('route_plans_trip_owner_idx').ifNotExists().on('route_plans').columns(['trip_id', 'owner_id']).execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  for (const table of ['route_plans', 'places', 'plan_change_sets', 'plan_versions', 'agent_messages', 'agent_conversations', 'anonymous_sessions'] as const) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
