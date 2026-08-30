import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../src/db.js';
import { migrateToLatest } from '../src/migrations/runner.js';
import { WebhookRepository } from '../src/repositories/webhook-repository.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('PostgreSQL webhook intake', () => {
  let db: ReturnType<typeof createDatabase>;
  let webhooks: WebhookRepository;

  beforeAll(async () => {
    db = createDatabase();
    await migrateToLatest(db);
    webhooks = new WebhookRepository(db);
  });

  afterAll(async () => closeDatabase(db));

  it('atomically deduplicates supplier events and enqueues one reference-only task', async () => {
    const suffix = Date.now().toString();
    const input = {
      supplierId: 'mock-rail',
      externalEventId: `external-${suffix}`,
      orderRef: { supplierId: 'mock-rail', supplierOrderId: `order-${suffix}` },
      payloadHash: 'hash-only',
      taskId: `webhook:mock-rail:external-${suffix}`,
      taskPayload: { supplierId: 'mock-rail', externalEventId: `external-${suffix}`, orderRef: { supplierId: 'mock-rail', supplierOrderId: `order-${suffix}` }, source: 'webhook' },
    };
    expect(await webhooks.accept(input)).toBe(true);
    expect(await webhooks.accept(input)).toBe(false);
    const tasks = await db.selectFrom('tasks').select(['payload_json']).where('id', '=', input.taskId).execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.payload_json).not.toContain('rawBody');
  });
});
