import { BookingRepository, InboxRepository, OfferRepository, OutboxRepository, TaskRepository, createDatabase, migrateToLatest } from '@travel/persistence';
import { PersistentReconciliationOrderStore, ReconciliationServiceImpl, SearchService } from '@travel/application';
import { MockAttractionAdapter, MockDiningAdapter, MockStayAdapter, MockTransportAdapter } from '@travel/supplier-adapters';
import { OutboxDispatchJob } from './jobs/outbox-dispatch-job.js';
import { ReconciliationJob } from './jobs/reconciliation-job.js';
import { SearchJob } from './jobs/search-job.js';
import { SupplierPollJob } from './jobs/supplier-poll-job.js';
import { TaskRunner } from './task-runner.js';

const db = createDatabase();
await migrateToLatest(db);
const adapters = [new MockTransportAdapter(), new MockStayAdapter(), new MockAttractionAdapter(), new MockDiningAdapter()];
const registry = { get: (supplierId: string) => adapters.find(adapter => adapter.supplierId === supplierId) };
const reconciliation = new ReconciliationServiceImpl(new PersistentReconciliationOrderStore(new BookingRepository(db)), registry);
const transport = adapters[0]!;
const search = new SearchService({ train: transport, flight: transport, stay: adapters[1], attraction: adapters[2], dining: adapters[3] });
const runner = new TaskRunner(
  new TaskRepository(db),
  [
    new SearchJob(search, new OfferRepository(db)),
    new SupplierPollJob(reconciliation),
    new ReconciliationJob(reconciliation),
    new ReconciliationJob(reconciliation, 'webhook_update'),
    new OutboxDispatchJob(new OutboxRepository(db), new InboxRepository(db), { name: 'event-stream', deliver: async () => undefined }),
  ],
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
