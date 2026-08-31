import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table supplier_orders add column if not exists after_sales_json text not null default '{}'`.execute(db);
  await db.schema.createTable('after_sales_requests').ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('order_id', 'varchar(128)', col => col.notNull().references('supplier_orders.id').onDelete('cascade'))
    .addColumn('action_request_id', 'varchar(128)', col => col.notNull())
    .addColumn('kind', 'varchar(16)', col => col.notNull())
    .addColumn('status', 'varchar(32)', col => col.notNull())
    .addColumn('amount_cents', 'integer')
    .addColumn('created_at', 'timestamptz', col => col.notNull().defaultTo(sql.raw('now()')))
    .execute();
}
export async function down(db: Kysely<Database>): Promise<void> { await db.schema.dropTable('after_sales_requests').ifExists().execute(); await sql`alter table supplier_orders drop column if exists after_sales_json`.execute(db); }
