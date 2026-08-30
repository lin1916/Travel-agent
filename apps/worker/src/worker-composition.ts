import type { ReconciliationService, SearchService } from '@travel/application';
import { BookingJob, type BookingTaskExecutor } from './jobs/booking-job.js';
import { OutboxDispatchJob, type DispatchableOutbox, type EventConsumer, type EventConsumerInbox } from './jobs/outbox-dispatch-job.js';
import { ReconciliationJob } from './jobs/reconciliation-job.js';
import { SearchJob, type SearchResultStore } from './jobs/search-job.js';
import { SupplierPollJob } from './jobs/supplier-poll-job.js';
import type { TaskHandler } from './task-runner.js';

export interface WorkerCompositionDependencies {
  search: SearchService;
  results: SearchResultStore;
  reconciliation: ReconciliationService;
  outbox: DispatchableOutbox;
  inbox: EventConsumerInbox;
  eventConsumer: EventConsumer;
  bookingExecutor: BookingTaskExecutor;
}

export function createWorkerHandlers(deps: WorkerCompositionDependencies): TaskHandler[] {
  return [new BookingJob(deps.bookingExecutor), new SearchJob(deps.search, deps.results), new SupplierPollJob(deps.reconciliation), new ReconciliationJob(deps.reconciliation), new ReconciliationJob(deps.reconciliation, 'webhook_update'), new OutboxDispatchJob(deps.outbox, deps.inbox, deps.eventConsumer)];
}
