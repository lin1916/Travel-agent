import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table inbox_messages add column if not exists claim_owner varchar(128)`.execute(db);
  await sql`alter table inbox_messages add column if not exists claim_until timestamptz`.execute(db);
  await sql`alter table inbox_messages add column if not exists delivered_at timestamptz`.execute(db);
  await sql`update inbox_messages set delivered_at = coalesce(delivered_at, processed_at) where delivered_at is null`.execute(db);
  await sql`create index if not exists inbox_claim_expiry_idx on inbox_messages(consumer_name, claim_until)`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists inbox_claim_expiry_idx`.execute(db);
  await sql`alter table inbox_messages drop column if exists delivered_at`.execute(db);
  await sql`alter table inbox_messages drop column if exists claim_until`.execute(db);
  await sql`alter table inbox_messages drop column if exists claim_owner`.execute(db);
}
