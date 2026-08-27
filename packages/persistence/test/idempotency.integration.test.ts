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

  it('distinguishes an in-flight duplicate from a completed replay and rejects a different request', async () => {
    const scope = 'trip:trip-' + Date.now() + ':commit';
    const request = { tripId: 'trip-1', offerIds: ['offer-1'] };
    expect(await idempotency.claim(scope, 'key-1', request)).toBe('claimed');
    expect(await idempotency.claim(scope, 'key-1', { offerIds: ['offer-1'], tripId: 'trip-1' })).toBe('replay');
    expect(await idempotency.getReplayState(scope, 'key-1')).toEqual({ status: 'in_flight' });
    await idempotency.complete(scope, 'key-1', { accepted: true });
    expect(await idempotency.claim(scope, 'key-1', request)).toBe('replay');
    expect(await idempotency.getReplayState(scope, 'key-1')).toEqual({
      status: 'completed',
      response: { accepted: true },
    });
    expect(await idempotency.claim(scope, 'key-1', { tripId: 'trip-1', offerIds: ['offer-2'] })).toBe('conflict');
  });
});
