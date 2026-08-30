import type { TaskOutcome } from '@travel/contracts';
import type { ReconciliationService } from '@travel/application';
import type { TaskHandler, TaskRecord } from '../task-runner.js';

function orderIdFrom(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || typeof (payload as { orderId?: unknown }).orderId !== 'string') throw new Error('supplier poll task requires orderId');
  return (payload as { orderId: string }).orderId;
}

export class SupplierPollJob implements TaskHandler {
  readonly kind = 'supplier_poll' as const;
  constructor(private readonly reconciliation: ReconciliationService) {}
  async handle(task: TaskRecord): Promise<TaskOutcome> {
    await this.reconciliation.reconcile(orderIdFrom(task.payload), 'poll');
    return { status: 'completed' };
  }
}
