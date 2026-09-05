import { sql, type Kysely } from 'kysely';
import type { Database } from '../types.js';

/** Conversation-first additions. This migration is intentionally append-only after 015. */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('planning_contexts')
    .ifNotExists()
    .addColumn('conversation_id', 'varchar(128)', col => col.primaryKey().references('agent_conversations.id').onDelete('cascade'))
    .addColumn('session_id', 'varchar(128)', col => col.notNull().references('anonymous_sessions.id').onDelete('cascade'))
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('destination', 'varchar(256)')
    .addColumn('origin', 'varchar(256)')
    .addColumn('starts_at', 'timestamptz')
    .addColumn('ends_at', 'timestamptz')
    .addColumn('traveler_count', 'integer')
    .addColumn('total_budget_cents', 'bigint')
    .addColumn('preferences_json', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('assumptions_json', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('missing_fields_json', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .execute();
  await db.schema.createIndex('planning_contexts_session_idx').ifNotExists().on('planning_contexts').column('session_id').execute();

  await db.schema
    .createTable('candidate_places')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('conversation_id', 'varchar(128)', col => col.notNull().references('agent_conversations.id').onDelete('cascade'))
    .addColumn('place_json', 'text', col => col.notNull())
    .addColumn('provider', 'varchar(64)', col => col.notNull())
    .addColumn('provider_place_id', 'varchar(256)', col => col.notNull())
    .addColumn('source', 'varchar(64)', col => col.notNull())
    .addColumn('note', 'text')
    .addColumn('priority', 'integer')
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addUniqueConstraint('candidate_places_conversation_provider_uq', ['conversation_id', 'provider', 'provider_place_id'])
    .execute();
  await db.schema.createIndex('candidate_places_order_idx').ifNotExists().on('candidate_places').columns(['conversation_id', 'priority', 'created_at']).execute();

  await db.schema
    .createTable('plan_proposals')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('conversation_id', 'varchar(128)', col => col.notNull().references('agent_conversations.id').onDelete('cascade'))
    .addColumn('trip_id', 'varchar(128)', col => col.notNull().references('trips.id').onDelete('cascade'))
    .addColumn('planning_context_version', 'integer', col => col.notNull())
    .addColumn('proposed_places_json', 'text', col => col.notNull())
    .addColumn('itinerary_json', 'text', col => col.notNull())
    .addColumn('budget_summary_json', 'text', col => col.notNull())
    .addColumn('warnings_json', 'text', col => col.notNull())
    .addColumn('reasoning_summary', 'text')
    .addColumn('status', 'varchar(32)', col => col.notNull())
    .addColumn('version', 'integer', col => col.notNull())
    .addColumn('accepted_place_ids_json', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .execute();
  await db.schema.createIndex('plan_proposals_current_idx').ifNotExists().on('plan_proposals').columns(['conversation_id', 'status', 'created_at']).execute();
  await db.schema.createIndex('plan_proposals_expiry_idx').ifNotExists().on('plan_proposals').column('expires_at').execute();

  await db.schema
    .createTable('proposal_idempotency_keys')
    .ifNotExists()
    .addColumn('conversation_id', 'varchar(128)', col => col.notNull().references('agent_conversations.id').onDelete('cascade'))
    .addColumn('proposal_id', 'varchar(128)', col => col.notNull().references('plan_proposals.id').onDelete('cascade'))
    .addColumn('idempotency_key', 'varchar(256)', col => col.notNull())
    .addColumn('request_hash', 'varchar(128)', col => col.notNull())
    .addColumn('response_json', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('proposal_idempotency_keys_pk', ['conversation_id', 'proposal_id', 'idempotency_key'])
    .execute();

  await sql`alter table agent_messages add column if not exists client_message_id varchar(36)`.execute(db);
  await sql`create unique index if not exists agent_messages_client_id_uq on agent_messages(conversation_id, client_message_id) where client_message_id is not null`.execute(db);

  await sql`alter table agent_runs add column if not exists conversation_id varchar(128)`.execute(db);
  await sql`alter table agent_runs add column if not exists planning_context_json text`.execute(db);
  await sql`alter table agent_runs add column if not exists reasoning_summary text`.execute(db);
  await sql`alter table agent_runs add column if not exists plan_proposal_json text`.execute(db);
  await sql`alter table agent_runs alter column trip_id drop not null`.execute(db);
  await sql`alter table agent_runs alter column current_trip_version drop not null`.execute(db);
  await sql`alter table agent_runs add constraint agent_runs_scope_ck check (conversation_id is not null or trip_id is not null)`.execute(db).catch(async error => {
    if (!(error instanceof Error) || !/already exists/i.test(error.message)) throw error;
  });
  await sql`alter table agent_runs add constraint agent_runs_conversation_fk foreign key (conversation_id) references agent_conversations(id) on delete cascade`.execute(db).catch(async error => {
    if (!(error instanceof Error) || !/already exists/i.test(error.message)) throw error;
  });
  await sql`create index if not exists agent_runs_conversation_idx on agent_runs(conversation_id, updated_at)`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists agent_runs_conversation_idx`.execute(db);
  await sql`alter table agent_runs drop constraint if exists agent_runs_conversation_fk`.execute(db);
  await sql`alter table agent_runs drop constraint if exists agent_runs_scope_ck`.execute(db);
  await sql`delete from agent_runs where trip_id is null`.execute(db);
  await sql`update agent_runs set current_trip_version = 1 where current_trip_version is null`.execute(db);
  await sql`alter table agent_runs alter column current_trip_version set not null`.execute(db);
  await sql`alter table agent_runs alter column trip_id set not null`.execute(db);
  await sql`alter table agent_runs drop column if exists plan_proposal_json`.execute(db);
  await sql`alter table agent_runs drop column if exists reasoning_summary`.execute(db);
  await sql`alter table agent_runs drop column if exists planning_context_json`.execute(db);
  await sql`alter table agent_runs drop column if exists conversation_id`.execute(db);
  await sql`drop index if exists agent_messages_client_id_uq`.execute(db);
  await sql`alter table agent_messages drop column if exists client_message_id`.execute(db);
  await db.schema.dropTable('proposal_idempotency_keys').ifExists().execute();
  await db.schema.dropTable('plan_proposals').ifExists().execute();
  await db.schema.dropTable('candidate_places').ifExists().execute();
  await db.schema.dropTable('planning_contexts').ifExists().execute();
}
