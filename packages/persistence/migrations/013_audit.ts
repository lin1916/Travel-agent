import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table agent_runs add column if not exists correlation_id varchar(256)`.execute(db);
  await db.schema.createTable('audit_entries').ifNotExists()
    .addColumn('id','varchar(128)', col=>col.primaryKey())
    .addColumn('trip_id','varchar(128)', col=>col.references('trips.id').onDelete('cascade'))
    .addColumn('actor_id','varchar(256)', col=>col.notNull())
    .addColumn('action','varchar(256)', col=>col.notNull())
    .addColumn('resource','varchar(256)', col=>col.notNull())
    .addColumn('supplier_id','varchar(256)')
    .addColumn('allowed_fields_json','text')
    .addColumn('policy_result','varchar(64)', col=>col.notNull())
    .addColumn('reason','text')
    .addColumn('mandate_version','integer')
    .addColumn('grant_ref','varchar(256)')
    .addColumn('request_id','varchar(256)', col=>col.notNull())
    .addColumn('correlation_id','varchar(256)', col=>col.notNull())
    .addColumn('occurred_at','timestamptz', col=>col.notNull())
    .addColumn('created_at','timestamptz', col=>col.notNull().defaultTo(sql.raw('now()')))
    .execute();
  await sql`create index if not exists audit_entries_trip_actor_idx on audit_entries(trip_id, actor_id, occurred_at desc)`.execute(db);
}
export async function down(db: Kysely<Database>): Promise<void> { await db.schema.dropTable('audit_entries').ifExists().execute(); }
