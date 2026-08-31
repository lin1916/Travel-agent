import type { TaskKind, TaskOutcome } from '@travel/contracts';
import type { ReconciliationService, ReconciliationSource } from '@travel/application';
import type { TaskHandler, TaskRecord } from '../task-runner.js';

export class ReconciliationJob implements TaskHandler {
  readonly kind: Extract<TaskKind, 'reconciliation' | 'webhook_update'>;
  constructor(
    private readonly reconciliation: ReconciliationService,
    kind: Extract<TaskKind, 'reconciliation' | 'webhook_update'> = 'reconciliation',
  ) { this.kind = kind; }

  async handle(task: TaskRecord): Promise<TaskOutcome> {
    if (!task.payload || typeof task.payload !== 'object') throw new Error('reconciliation task payload is invalid');
    const payload = task.payload as { orderId?: unknown; source?: unknown; requestId?: unknown; correlationId?: unknown };
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : undefined;
    if (!orderId) throw new Error('reconciliation task requires orderId');
    const requestedSource = payload.source;
    const source: ReconciliationSource = requestedSource === 'webhook' || requestedSource === 'poll' || requestedSource === 'manual'
      ? requestedSource
      : this.kind === 'webhook_update' ? 'webhook' : 'manual';
    await this.reconciliation.reconcile(orderId, source, { requestId: typeof payload.requestId === 'string' ? payload.requestId : undefined, correlationId: typeof payload.correlationId === 'string' ? payload.correlationId : undefined });
    return { status: 'completed' };
  }
}
