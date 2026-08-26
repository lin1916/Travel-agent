import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './types.js';
import { DatabaseConfigurationError } from './types.js';

export function createDatabase(databaseUrl = process.env.DATABASE_URL): Kysely<Database> {
  if (!databaseUrl) {
    throw new DatabaseConfigurationError();
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 5000),
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export type DatabaseTransaction = Transaction<Database>;

export async function withTransaction<T>(
  db: Kysely<Database>,
  callback: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(callback);
}

export async function closeDatabase(db: Kysely<Database>): Promise<void> {
  await db.destroy();
}
