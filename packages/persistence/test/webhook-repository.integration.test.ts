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
    const localOrderId = `local-order-${suffix}`;
    const supplierOrderId = `supplier-order-${suffix}`;
    const intentId = `intent-${suffix}`;
    await db.insertInto('trips').values({ id: `trip-${suffix}`, owner_id: 'owner-1', version: 1, destination: '杭州', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString(), traveler_count: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).execute();
    await db.insertInto('booking_intents').values({ id: intentId, trip_id: `trip-${suffix}`, owner_id: 'owner-1', offer_id: `offer-${suffix}`, offer_kind: 'train', status: 'awaiting_supplier', version: 1, payload_json: '{}', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).execute();
    await db.insertInto('supplier_orders').values({ id: localOrderId, intent_id: intentId, supplier_id: 'mock-rail', lifecycle_status: 'payment_unknown', reconciliation_status: 'pending', payload_json: JSON.stringify({ lifecycleStatus: 'payment_unknown', reconciliationStatus: 'pending', supplierOrderRef: { supplierId: 'mock-rail', supplierOrderId } }), external_idempotency_key: `key-${suffix}`, created_at: new Date().toISOString() }).execute();
    const input = {
      supplierId: 'mock-rail',
      externalEventId: `external-${suffix}`,
      orderRef: { supplierId: 'mock-rail', supplierOrderId },
      payloadHash: 'hash-only',
      taskId: `webhook:mock-rail:external-${suffix}`,
      taskPayload: { orderId: localOrderId, supplierId: 'mock-rail', externalEventId: `external-${suffix}`, orderRef: { supplierId: 'mock-rail', supplierOrderId }, source: 'webhook' },
    };
    expect(await webhooks.accept(input)).toBe(true);
    expect(await webhooks.accept(input)).toBe(false);
    const tasks = await db.selectFrom('tasks').select(['payload_json']).where('id', '=', input.taskId).execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.payload_json).not.toContain('rawBody');
    expect(JSON.parse(tasks[0]!.payload_json)).toMatchObject({ orderId: localOrderId, orderRef: { supplierOrderId } });
  });
});
