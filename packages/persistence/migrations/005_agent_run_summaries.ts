import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/types.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table agent_runs add column if not exists tool_call_summaries_json text not null default '[]'`.execute(db);
}

export async function down(_db: Kysely<Database>): Promise<void> {}
