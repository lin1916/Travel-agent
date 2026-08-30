import { describe, expect, it } from 'vitest';
import type { TaskOutcome } from '@travel/contracts';
import { SearchService } from '@travel/application';
import { MockTransportAdapter } from '@travel/supplier-adapters';
import { OutboxDispatchJob } from '../src/jobs/outbox-dispatch-job.js';
import { SearchJob } from '../src/jobs/search-job.js';
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
      { claim: async (consumerName, eventId) => { const key = `${consumerName}:${eventId}`; if (claimed.has(key)) return false; claimed.add(key); return true; }, release: async (consumerName, eventId) => { claimed.delete(`${consumerName}:${eventId}`); } },
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
        claim: async (consumerName, eventId) => { const key = `${consumerName}:${eventId}`; if (claimed.has(key)) return false; claimed.add(key); return true; },
        release: async (consumerName, eventId) => { claimed.delete(`${consumerName}:${eventId}`); },
      },
      { name: 'trip-sse', deliver: async () => { deliveries += 1; if (deliveries === 1) throw new Error('temporary delivery failure'); } },
    );

    await expect(job.handle({ id: 'dispatch-1', kind: 'outbox_dispatch', payload: {}, attempts: 1 })).rejects.toThrow('temporary delivery failure');
    await job.handle({ id: 'dispatch-2', kind: 'outbox_dispatch', payload: {}, attempts: 2 });

    expect(deliveries).toBe(2);
    expect(published).toEqual(['event-retry']);
  });
});
