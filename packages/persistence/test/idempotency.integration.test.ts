import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, closeDatabase } from '../src/db.js';
import { migrateToLatest } from '../src/migrations/runner.js';
import { IdempotencyRepository } from '../src/repositories/idempotency-repository.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('PostgreSQL idempotency', () => {
  let db: ReturnType<typeof createDatabase>;
  let idempotency: IdempotencyRepository;

  beforeAll(async () => {
    db = createDatabase();
    await migrateToLatest(db);
    idempotency = new IdempotencyRepository(db);
  });

  afterAll(async () => {
    await closeDatabase(db);
  });

  it('replays an identical request and rejects a different request', async () => {
    const scope = 'trip:trip-' + Date.now() + ':commit';
    expect(await idempotency.claim(scope, 'key-1', 'hash-a')).toBe('claimed');
    await idempotency.complete(scope, 'key-1', { accepted: true });
    expect(await idempotency.claim(scope, 'key-1', 'hash-a')).toBe('replay');
    expect(await idempotency.claim(scope, 'key-1', 'hash-b')).toBe('conflict');
  });
});
