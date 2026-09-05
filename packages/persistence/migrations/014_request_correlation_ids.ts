import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table agent_runs add column if not exists request_id varchar(256)`.execute(db);
  await sql`alter table action_requests add column if not exists request_id varchar(256)`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table action_requests drop column if exists request_id`.execute(db);
  await sql`alter table agent_runs drop column if exists request_id`.execute(db);
}
