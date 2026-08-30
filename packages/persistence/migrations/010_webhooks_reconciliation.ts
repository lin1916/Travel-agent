import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_log add column if not exists trip_id varchar(128) references trips(id) on delete cascade`.execute(db);
  await sql`alter table event_log add column if not exists stream_position bigserial`.execute(db);
  await sql`create unique index if not exists event_log_stream_position_uq on event_log(stream_position)`.execute(db);
  await sql`create index if not exists event_log_trip_stream_idx on event_log(trip_id, stream_position)`.execute(db);

  await sql`alter table outbox_events add column if not exists trip_id varchar(128) references trips(id) on delete cascade`.execute(db);
  await sql`create index if not exists outbox_unpublished_idx on outbox_events(published_at, id)`.execute(db);

  await sql`update outbox_events set trip_id = aggregate_id where trip_id is null and aggregate_type = 'Trip' and exists (select 1 from trips where trips.id = outbox_events.aggregate_id)`.execute(db);
  await sql`update outbox_events set trip_id = booking_intents.trip_id from booking_intents where outbox_events.trip_id is null and outbox_events.aggregate_type = 'BookingIntent' and booking_intents.id = outbox_events.aggregate_id`.execute(db);
  await sql`update outbox_events set trip_id = booking_intents.trip_id from supplier_orders join booking_intents on booking_intents.id = supplier_orders.intent_id where outbox_events.trip_id is null and outbox_events.aggregate_type = 'SupplierOrder' and supplier_orders.id = outbox_events.aggregate_id`.execute(db);
  await sql`update outbox_events set trip_id = agent_runs.trip_id from agent_runs where outbox_events.trip_id is null and outbox_events.aggregate_type = 'AgentRun' and agent_runs.id = outbox_events.aggregate_id`.execute(db);

  await sql`update event_log set trip_id = aggregate_id where trip_id is null and aggregate_type = 'Trip' and exists (select 1 from trips where trips.id = event_log.aggregate_id)`.execute(db);
  await sql`update event_log set trip_id = booking_intents.trip_id from booking_intents where event_log.trip_id is null and event_log.aggregate_type = 'BookingIntent' and booking_intents.id = event_log.aggregate_id`.execute(db);
  await sql`update event_log set trip_id = booking_intents.trip_id from supplier_orders join booking_intents on booking_intents.id = supplier_orders.intent_id where event_log.trip_id is null and event_log.aggregate_type = 'SupplierOrder' and supplier_orders.id = event_log.aggregate_id`.execute(db);
  await sql`update event_log set trip_id = agent_runs.trip_id from agent_runs where event_log.trip_id is null and event_log.aggregate_type = 'AgentRun' and agent_runs.id = event_log.aggregate_id`.execute(db);

  await sql`insert into event_log (event_id, event_type, aggregate_type, aggregate_id, trip_id, run_id, sequence, schema_version, occurred_at, request_id, correlation_id, payload_json)
    select event_id, event_type, aggregate_type, aggregate_id, trip_id, null, sequence, 1, created_at, 'migration:' || event_id, 'migration:' || event_id, payload_json
    from outbox_events on conflict do nothing`.execute(db);

  await sql`alter table supplier_orders add column if not exists payment_location varchar(32) not null default 'unknown'`.execute(db);
  await sql`alter table supplier_orders add column if not exists ticket_or_reservation_ref varchar(256)`.execute(db);
  await sql`alter table supplier_orders add column if not exists refund_rules text not null default ''`.execute(db);
  await sql`alter table supplier_orders add column if not exists required_user_action text`.execute(db);
  await sql`alter table supplier_orders add column if not exists last_updated_at timestamptz not null default now()`.execute(db);

  await db.schema.createTable('webhook_receipts').ifNotExists()
    .addColumn('supplier_id', 'varchar(128)', col => col.notNull())
    .addColumn('external_event_id', 'varchar(256)', col => col.notNull())
    .addColumn('order_id', 'varchar(128)', col => col.notNull())
    .addColumn('payload_hash', 'varchar(128)', col => col.notNull())
    .addColumn('task_id', 'varchar(128)', col => col.notNull())
    .addColumn('received_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .addPrimaryKeyConstraint('webhook_receipts_pk', ['supplier_id', 'external_event_id'])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('webhook_receipts').ifExists().execute();
}
