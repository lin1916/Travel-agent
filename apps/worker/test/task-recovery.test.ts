import { describe, expect, it } from 'vitest';
import type { TaskOutcome } from '@travel/contracts';
import { SearchService } from '@travel/application';
import { MockTransportAdapter } from '@travel/supplier-adapters';
import { OutboxDispatchJob } from '../src/jobs/outbox-dispatch-job.js';
import { BookingJob } from '../src/jobs/booking-job.js';
import { SearchJob } from '../src/jobs/search-job.js';
import { ReconciliationJob } from '../src/jobs/reconciliation-job.js';
import { createWorkerHandlers } from '../src/worker-composition.js';
import {
  TaskRunner,
  type TaskHandler,
  type TaskRecord,
  type WorkerTaskStore,
} from '../src/task-runner.js';

class RecoverableTaskStore implements WorkerTaskStore {
  readonly task: TaskRecord & {
    status: 'pending' | 'leased' | 'completed' | 'dead_letter';
    availableAt: string;
    leaseOwner?: string;
    lastError?: string;
  };

  constructor(kind: TaskRecord['kind'], payload: unknown, now: Date) {
    this.task = {
      id: 'task-1',
      kind,
      payload,
      attempts: 0,
      status: 'pending',
      availableAt: now.toISOString(),
    };
  }

  async lease(workerId: string, now: Date, leaseSeconds: number) {
    const eligible = this.task.status === 'pending'
      ? this.task.availableAt <= now.toISOString()
      : this.task.status === 'leased' && Boolean(this.task.leaseUntil) && this.task.leaseUntil! <= now.toISOString();
    if (!eligible) return null;
    this.task.status = 'leased';
    this.task.leaseOwner = workerId;
    this.task.leaseUntil = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
    this.task.attempts += 1;
    return { ...this.task, leaseOwner: workerId, leaseUntil: this.task.leaseUntil };
  }

  async heartbeat(taskId: string, workerId: string, now: Date, leaseSeconds: number) {
    if (taskId !== this.task.id || this.task.status !== 'leased' || this.task.leaseOwner !== workerId || this.task.leaseUntil! <= now.toISOString()) return false;
    this.task.leaseUntil = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
    return true;
  }

  async complete(taskId: string, workerId: string, completion: { status: Extract<TaskOutcome['status'], 'completed' | 'dead_letter'>; error?: string }) {
    if (taskId !== this.task.id || this.task.status !== 'leased' || this.task.leaseOwner !== workerId) return false;
    this.task.status = completion.status;
    this.task.lastError = completion.error;
    delete this.task.leaseOwner;
    delete this.task.leaseUntil;
    return true;
  }

  async retry(taskId: string, workerId: string, retryAt: Date, error: string) {
    if (taskId !== this.task.id || this.task.status !== 'leased' || this.task.leaseOwner !== workerId) return false;
    this.task.status = 'pending';
    this.task.availableAt = retryAt.toISOString();
    this.task.lastError = error;
    delete this.task.leaseOwner;
    delete this.task.leaseUntil;
    return true;
  }
}

class OutcomeHandler implements TaskHandler {
  readonly kind = 'booking' as const;
  constructor(private readonly outcome: TaskOutcome | Error) {}
  async handle(): Promise<TaskOutcome> {
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

describe('recoverable worker tasks', () => {
  it('registers booking work in the production handler composition and executes the injected boundary', async () => {
    const executed: Array<{ taskId: string; payload: unknown }> = [];
    const handlers = createWorkerHandlers({
      search: {} as never,
      results: { saveSearchResult: async () => undefined },
      reconciliation: { reconcile: async () => ({ orderId: 'unused', status: 'matched', lifecycleStatus: 'confirmed' }) },
      outbox: { pending: async () => [], markPublished: async () => undefined },
      inbox: { claim: async () => 'busy', complete: async () => false, release: async () => undefined },
      bookingExecutor: { execute: async (taskId, payload) => { executed.push({ taskId, payload }); } },
      eventConsumer: { name: 'unused', deliver: async () => undefined },
    });
    const booking = handlers.find(handler => handler.kind === 'booking');

    expect(booking).toBeInstanceOf(BookingJob);
    await expect(booking?.handle({ id: 'booking-task-1', kind: 'booking', payload: { orderId: 'local-order-1' }, attempts: 1 })).resolves.toEqual({ status: 'completed' });
    expect(executed).toEqual([{ taskId: 'booking-task-1', payload: { orderId: 'local-order-1' } }]);
  });

  it('executes a queued search and persists normalized offers for its Trip', async () => {
    const saved: Array<{ taskId: string; tripId: string; offerIds: string[] }> = [];
    const transport = new MockTransportAdapter();
    const job = new SearchJob(
      new SearchService({ train: transport, flight: transport }),
      { saveSearchResult: async (taskId, tripId, offers) => { saved.push({ taskId, tripId, offerIds: offers.map(offer => offer.id) }); } },
    );
    const outcome = await job.handle({
      id: 'search-task-1', kind: 'search', attempts: 1,
      payload: { requests: [{ tripId: 'trip-1', kind: 'train', origin: '上海', destination: '杭州', startsAt: '2026-09-10T08:00:00.000+08:00', travelers: 1 }], mode: 'value' },
    });

    expect(outcome).toEqual({ status: 'completed' });
    expect(saved).toEqual([{ taskId: 'search-task-1', tripId: 'trip-1', offerIds: ['train-001', 'train-002'] }]);
  });

  it('retries a search with a retryable category failure without persisting partial results', async () => {
    const saved: unknown[] = [];
    const retryable = Object.assign(new Error('supplier temporarily unavailable'), { retryable: true });
    const job = new SearchJob(
      new SearchService({
        train: new MockTransportAdapter(),
        flight: { ...new MockTransportAdapter(), supplierId: 'retry-flight', kind: 'flight', search: async () => { throw retryable; } },
      }),
      { saveSearchResult: async (...args) => { saved.push(args); } },
    );

    const outcome = await job.handle({
      id: 'search-task-retry', kind: 'search', attempts: 1,
      payload: { requests: [
        { tripId: 'trip-1', kind: 'train', origin: '上海', destination: '杭州', startsAt: '2026-09-10T08:00:00.000+08:00', travelers: 1 },
        { tripId: 'trip-1', kind: 'flight', origin: '上海', destination: '广州', startsAt: '2026-09-10T08:00:00.000+08:00', travelers: 1 },
      ], mode: 'value' },
    });

    expect(outcome).toEqual({ status: 'retry', reason: 'supplier temporarily unavailable' });
    expect(saved).toEqual([]);
  });

  it('never treats a supplier order reference as the local reconciliation order ID', async () => {
    const reconciled: string[] = [];
    const job = new ReconciliationJob({ reconcile: async orderId => { reconciled.push(orderId); return { orderId, status: 'matched', lifecycleStatus: 'confirmed' }; } }, 'webhook_update');

    await expect(job.handle({ id: 'webhook-task-1', kind: 'webhook_update', attempts: 1, payload: { orderRef: { supplierOrderId: 'supplier-order-1' }, source: 'webhook' } })).rejects.toThrow('reconciliation task requires orderId');
    expect(reconciled).toEqual([]);
  });

  it('reclaims an expired lease exactly once and rejects stale-owner heartbeat/completion', async () => {
    const start = new Date('2026-08-31T00:00:00.000Z');
    const store = new RecoverableTaskStore('booking', { orderId: 'order-1' }, start);
    const first = await store.lease('worker-a', start, 10);
    expect(first?.leaseOwner).toBe('worker-a');

    const afterExpiry = new Date('2026-08-31T00:00:11.000Z');
    const reclaimed = await store.lease('worker-b', afterExpiry, 10);
    expect(reclaimed?.leaseOwner).toBe('worker-b');
    expect(await store.lease('worker-c', afterExpiry, 10)).toBeNull();
    expect(await store.heartbeat('task-1', 'worker-a', afterExpiry, 10)).toBe(false);
    expect(await store.complete('task-1', 'worker-a', { status: 'completed' })).toBe(false);
    expect(store.task.status).toBe('leased');
    expect(store.task.leaseOwner).toBe('worker-b');
  });

  it('uses exponential backoff for retryable failure and dead-letters a terminal failure', async () => {
    const start = new Date('2026-08-31T00:00:00.000Z');
    const retryStore = new RecoverableTaskStore('booking', { orderId: 'order-1' }, start);
    const retryable = Object.assign(new Error('supplier timeout'), { retryable: true });
    const retryRunner = new TaskRunner(retryStore, [new OutcomeHandler(retryable)], {
      workerId: 'worker-a', leaseSeconds: 30, maxAttempts: 3, baseBackoffMs: 1_000, now: () => start,
    });
    await retryRunner.runOnce();
    expect(retryStore.task.status).toBe('pending');
    expect(retryStore.task.availableAt).toBe('2026-08-31T00:00:01.000Z');

    const deadStore = new RecoverableTaskStore('booking', { orderId: 'order-2' }, start);
    const deadRunner = new TaskRunner(deadStore, [new OutcomeHandler(new Error('invalid task payload'))], {
      workerId: 'worker-b', leaseSeconds: 30, maxAttempts: 3, baseBackoffMs: 1_000, now: () => start,
    });
    await deadRunner.runOnce();
    expect(deadStore.task.status).toBe('dead_letter');
    expect(deadStore.task.lastError).toBe('invalid task payload');
  });

  it('dead-letters an explicit retry outcome at the attempt ceiling', async () => {
    const start = new Date('2026-08-30T00:00:00.000Z');
    const store = new RecoverableTaskStore('booking', { orderId: 'order-3' }, start);
    store.task.attempts = 2;
    const runner = new TaskRunner(store, [new OutcomeHandler({ status: 'retry', reason: 'supplier unavailable' })], {
      workerId: 'worker-a', leaseSeconds: 30, maxAttempts: 3, baseBackoffMs: 1_000, now: () => start,
    });
    await runner.runOnce();
    expect(store.task.status).toBe('dead_letter');
    expect(store.task.lastError).toBe('supplier unavailable');
  });

  it('dispatches an outbox event only once to the same Inbox consumer', async () => {
    const event = {
      event_id: 'event-1', event_type: 'SupplierOrderUpdated', aggregate_type: 'SupplierOrder', aggregate_id: 'order-1',
      sequence: 1, schema_version: 1, occurred_at: '2026-08-31T00:00:00.000Z', request_id: 'request-1',
      correlation_id: 'correlation-1', redacted_payload: { lifecycleStatus: 'confirmed' },
    };
    const claimed = new Set<string>();
    const delivered: string[] = [];
    const published: string[] = [];
    const job = new OutboxDispatchJob(
      { pending: async () => [event], markPublished: async eventId => { published.push(eventId); } },
      { claim: async (consumerName, eventId) => { const key = `${consumerName}:${eventId}`; if (claimed.has(key)) return 'completed'; claimed.add(key); return 'claimed'; }, complete: async () => true, release: async (consumerName, eventId) => { claimed.delete(`${consumerName}:${eventId}`); } },
      { name: 'trip-sse', deliver: async envelope => { delivered.push(envelope.event_id); } },
    );

    await job.handle({ id: 'dispatch-1', kind: 'outbox_dispatch', payload: {}, attempts: 1 });
    await job.handle({ id: 'dispatch-2', kind: 'outbox_dispatch', payload: {}, attempts: 1 });

    expect(delivered).toEqual(['event-1']);
    expect(published).toEqual(['event-1', 'event-1']);
  });

  it('releases an Inbox claim when delivery fails so the outbox can retry', async () => {
    const event = {
      event_id: 'event-retry', event_type: 'SupplierOrderUpdated', aggregate_type: 'SupplierOrder', aggregate_id: 'order-1',
      sequence: 1, schema_version: 1, occurred_at: '2026-08-30T00:00:00.000Z', request_id: 'request-1',
      correlation_id: 'correlation-1', redacted_payload: { lifecycleStatus: 'confirmed' },
    };
    const claimed = new Set<string>();
    const published: string[] = [];
    let deliveries = 0;
    const job = new OutboxDispatchJob(
      { pending: async () => [event], markPublished: async eventId => { published.push(eventId); } },
      {
        claim: async (consumerName, eventId) => { const key = `${consumerName}:${eventId}`; if (claimed.has(key)) return 'completed'; claimed.add(key); return 'claimed'; },
        complete: async () => true,
        release: async (consumerName, eventId) => { claimed.delete(`${consumerName}:${eventId}`); },
      },
      { name: 'trip-sse', deliver: async () => { deliveries += 1; if (deliveries === 1) throw new Error('temporary delivery failure'); } },
    );

    await expect(job.handle({ id: 'dispatch-1', kind: 'outbox_dispatch', payload: {}, attempts: 1 })).rejects.toThrow('temporary delivery failure');
    await job.handle({ id: 'dispatch-2', kind: 'outbox_dispatch', payload: {}, attempts: 2 });

    expect(deliveries).toBe(2);
    expect(published).toEqual(['event-retry']);
  });

  it('reclaims a crashed Inbox lease, prevents concurrent delivery, and publishes only after successful delivery', async () => {
    const event = {
      event_id: 'event-crash', event_type: 'SupplierOrderUpdated', aggregate_type: 'SupplierOrder', aggregate_id: 'order-1',
      sequence: 1, schema_version: 1, occurred_at: '2026-08-30T00:00:00.000Z', request_id: 'request-1',
      correlation_id: 'correlation-1', redacted_payload: { lifecycleStatus: 'confirmed' },
    };
    let now = new Date('2026-08-30T00:00:00.000Z');
    let claim: { owner: string; until: number; completed: boolean } | undefined;
    const inbox = {
      claim: async (_consumer: string, _eventId: string, owner: string, claimedAt: Date, leaseSeconds: number) => {
        if (claim?.completed) return 'completed' as const;
        if (claim && claim.until > claimedAt.getTime() && claim.owner !== owner) return 'busy' as const;
        claim = { owner, until: claimedAt.getTime() + leaseSeconds * 1_000, completed: false };
        return 'claimed' as const;
      },
      complete: async (_consumer: string, _eventId: string, owner: string) => {
        if (!claim || claim.owner !== owner || claim.until <= now.getTime()) return false;
        claim.completed = true;
        return true;
      },
      release: async (_consumer: string, _eventId: string, owner: string) => { if (claim?.owner === owner) claim = undefined; },
    };
    const published: string[] = [];
    const deliveries: string[] = [];
    const outbox = { pending: async () => [event], markPublished: async (eventId: string) => { published.push(eventId); } };

    expect(await inbox.claim('trip-sse', event.event_id, 'crashed-worker', now, 10)).toBe('claimed');
    const first = new OutboxDispatchJob(outbox, inbox, { name: 'trip-sse', deliver: async envelope => { deliveries.push(envelope.event_id); } }, { now: () => now, claimLeaseSeconds: 10 });
    expect(await first.handle({ id: 'concurrent-worker', kind: 'outbox_dispatch', payload: {}, attempts: 1 })).toEqual({ status: 'retry', reason: 'outbox delivery claim is busy' });
    expect(deliveries).toEqual([]);
    expect(published).toEqual([]);

    now = new Date('2026-08-30T00:00:11.000Z');
    const [reclaimed, concurrent] = await Promise.all([
      first.handle({ id: 'reclaiming-worker', kind: 'outbox_dispatch', payload: {}, attempts: 2 }),
      first.handle({ id: 'other-worker', kind: 'outbox_dispatch', payload: {}, attempts: 2 }),
    ]);
    expect([reclaimed.status, concurrent.status].sort()).toEqual(['completed', 'retry']);
    expect(deliveries).toEqual(['event-crash']);
    expect(published).toEqual(['event-crash']);
  });
});
