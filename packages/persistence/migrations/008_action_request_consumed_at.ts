import type { Kysely } from 'kysely';
import type { Database } from '../src/types.js';
export async function up(db: Kysely<Database>): Promise<void> { await db.schema.alterTable('action_requests').addColumn('consumed_at', 'timestamptz').execute(); }
export async function down(db: Kysely<Database>): Promise<void> { await db.schema.alterTable('action_requests').dropColumn('consumed_at').execute(); }
