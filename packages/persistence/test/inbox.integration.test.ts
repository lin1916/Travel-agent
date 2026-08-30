import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../src/db.js';
import { InboxRepository } from '../src/inbox/inbox-repository.js';
import { migrateToLatest } from '../src/migrations/runner.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('PostgreSQL inbox', () => {
  let db: ReturnType<typeof createDatabase>;
  let inbox: InboxRepository;

  beforeAll(async () => {
    db = createDatabase();
    await migrateToLatest(db);
    inbox = new InboxRepository(db);
  });

  afterAll(async () => {
    await closeDatabase(db);
  });

  it('returns false when an external event ID was already claimed', async () => {
    const consumer = 'consumer-' + Date.now();
    expect(await inbox.claim(consumer, 'event-1', 'external-1')).toBe(true);
    expect(await inbox.claim(consumer, 'event-2', 'external-1')).toBe(false);
  });

  it('can release a failed delivery claim for retry', async () => {
    const consumer = 'retry-consumer-' + Date.now();
    expect(await inbox.claim(consumer, 'retry-event-1')).toBe(true);
    await inbox.release(consumer, 'retry-event-1');
    expect(await inbox.claim(consumer, 'retry-event-1')).toBe(true);
  });
});
