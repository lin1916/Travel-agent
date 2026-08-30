import { BookingRepository, InboxRepository, OfferRepository, OutboxRepository, TaskRepository, createDatabase, migrateToLatest } from '@travel/persistence';
import { PersistentReconciliationOrderStore, ReconciliationServiceImpl, SearchService } from '@travel/application';
import { MockAttractionAdapter, MockDiningAdapter, MockStayAdapter, MockTransportAdapter } from '@travel/supplier-adapters';
import { TaskRunner } from './task-runner.js';
import { createWorkerHandlers } from './worker-composition.js';

const db = createDatabase();
await migrateToLatest(db);
const adapters = [new MockTransportAdapter(), new MockStayAdapter(), new MockAttractionAdapter(), new MockDiningAdapter()];
const registry = { get: (supplierId: string) => adapters.find(adapter => adapter.supplierId === supplierId) };
const reconciliation = new ReconciliationServiceImpl(new PersistentReconciliationOrderStore(new BookingRepository(db)), registry);
const transport = adapters[0]!;
const search = new SearchService({ train: transport, flight: transport, stay: adapters[1], attraction: adapters[2], dining: adapters[3] });
const runner = new TaskRunner(new TaskRepository(db), createWorkerHandlers({
    bookingExecutor: { execute: async () => { throw new Error('durable booking executor is not configured'); } },
    search,
    results: new OfferRepository(db),
    reconciliation,
    outbox: new OutboxRepository(db),
    inbox: new InboxRepository(db),
    eventConsumer: { name: 'event-stream', deliver: async () => { throw new Error('durable event-stream handoff is not configured'); } },
  }),
  {
    workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
    leaseSeconds: Number(process.env.WORKER_LEASE_SECONDS ?? 30),
    maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 5),
    baseBackoffMs: Number(process.env.WORKER_BACKOFF_MS ?? 1_000),
  },
);

while (true) {
  const task = await runner.runOnce();
  if (!task) await new Promise(resolve => setTimeout(resolve, 250));
}
