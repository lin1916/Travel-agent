import type { Kysely } from 'kysely';
import { canonicalRequestHash, type Database } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

export type IdempotencyClaim = 'claimed' | 'replay' | 'conflict';
export type IdempotencyReplayState<T = unknown> =
  | { status: 'in_flight' }
  | { status: 'completed'; response: T };

export class IdempotencyRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async claim(scope: string, key: string, request: unknown, tx?: DatabaseTransaction): Promise<IdempotencyClaim> {
    const requestHash = canonicalRequestHash(request);
    const connection = tx ?? this.db;
    const inserted = await connection
      .insertInto('idempotency_keys')
      .values({
        scope,
        key,
        request_hash: requestHash,
        status: 'claimed',
        response_json: null,
        created_at: new Date().toISOString(),
        expires_at: null,
      })
      .onConflict(oc => oc.columns(['scope', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();
    if (inserted) {
      return 'claimed';
    }

    const existing = await connection
      .selectFrom('idempotency_keys')
      .select(['request_hash', 'status'])
      .where('scope', '=', scope)
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    return existing.request_hash === requestHash ? 'replay' : 'conflict';
  }

  async complete(scope: string, key: string, response: unknown, tx?: DatabaseTransaction): Promise<void> {
    await (tx ?? this.db)
      .updateTable('idempotency_keys')
      .set({ status: 'completed', response_json: JSON.stringify(response) })
      .where('scope', '=', scope)
      .where('key', '=', key)
      .execute();
  }

  async getReplayState<T = unknown>(scope: string, key: string): Promise<IdempotencyReplayState<T> | null> {
    const row = await this.db
      .selectFrom('idempotency_keys')
      .select(['status', 'response_json'])
      .where('scope', '=', scope)
      .where('key', '=', key)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    if (row.status === 'claimed') {
      return { status: 'in_flight' };
    }
    return { status: 'completed', response: JSON.parse(row.response_json ?? 'null') as T };
  }

  async getResponse<T>(scope: string, key: string): Promise<T | null> {
    const row = await this.db
      .selectFrom('idempotency_keys')
      .select(['status', 'response_json'])
      .where('scope', '=', scope)
      .where('key', '=', key)
      .executeTakeFirst();
    if (!row?.response_json || row.status !== 'completed') {
      return null;
    }
    return JSON.parse(row.response_json) as T;
  }
}
