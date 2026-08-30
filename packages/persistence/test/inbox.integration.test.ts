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
    const now = new Date();
    expect(await inbox.claim(consumer, 'event-1', 'owner-1', now, 30, 'external-1')).toBe('claimed');
    expect(await inbox.complete(consumer, 'event-1', 'owner-1', now)).toBe(true);
    expect(await inbox.claim(consumer, 'event-2', 'owner-2', now, 30, 'external-1')).toBe('completed');
  });

  it('can release a failed delivery claim for retry', async () => {
    const consumer = 'retry-consumer-' + Date.now();
    const now = new Date();
    expect(await inbox.claim(consumer, 'retry-event-1', 'owner-1', now, 30)).toBe('claimed');
    await inbox.release(consumer, 'retry-event-1', 'owner-1');
    expect(await inbox.claim(consumer, 'retry-event-1', 'owner-2', now, 30)).toBe('claimed');
  });

  it('allows exactly one concurrent claimant and reclaims an expired delivery lease', async () => {
    const consumer = 'lease-consumer-' + Date.now();
    const start = new Date('2026-08-30T00:00:00.000Z');
    const claims = await Promise.all([
      inbox.claim(consumer, 'leased-event-1', 'owner-1', start, 10),
      inbox.claim(consumer, 'leased-event-1', 'owner-2', start, 10),
    ]);
    expect(claims.sort()).toEqual(['busy', 'claimed']);
    expect(await inbox.claim(consumer, 'leased-event-1', 'owner-3', new Date('2026-08-30T00:00:11.000Z'), 10)).toBe('claimed');
  });
});
