import type { TaskKind, TaskOutcome } from '@travel/contracts';

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  payload: unknown;
  attempts: number;
  leaseUntil?: string;
}

export interface TaskHandler {
  kind: TaskKind;
  handle(task: TaskRecord): Promise<TaskOutcome>;
}

export interface WorkerTaskStore {
  lease(workerId: string, now: Date, leaseSeconds: number): Promise<(TaskRecord & { leaseOwner: string; leaseUntil: string }) | null>;
  heartbeat(taskId: string, workerId: string, now: Date, leaseSeconds: number): Promise<boolean>;
  complete(taskId: string, workerId: string, completion: { status: Extract<TaskOutcome['status'], 'completed' | 'dead_letter'>; error?: string }, now: Date): Promise<boolean>;
  retry(taskId: string, workerId: string, retryAt: Date, error: string, now: Date): Promise<boolean>;
}

export interface TaskRunnerOptions {
  workerId: string;
  leaseSeconds: number;
  maxAttempts: number;
  baseBackoffMs: number;
  now?: () => Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'task handler failed';
}

function isRetryable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'retryable' in error && (error as { retryable?: unknown }).retryable === true);
}

export class TaskRunner {
  private readonly handlers: Map<TaskKind, TaskHandler>;
  private readonly now: () => Date;

  constructor(
    private readonly tasks: WorkerTaskStore,
    handlers: readonly TaskHandler[],
    private readonly options: TaskRunnerOptions,
  ) {
    this.handlers = new Map(handlers.map(handler => [handler.kind, handler]));
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<TaskRecord | null> {
    const task = await this.tasks.lease(this.options.workerId, this.now(), this.options.leaseSeconds);
    if (!task) return null;

    const handler = this.handlers.get(task.kind);
    if (!handler) {
      await this.tasks.complete(task.id, this.options.workerId, { status: 'dead_letter', error: `no handler for task kind ${task.kind}` }, this.now());
      return task;
    }

    const heartbeatMs = Math.max(100, Math.floor(this.options.leaseSeconds * 1_000 / 3));
    const heartbeat = setInterval(() => {
      void this.tasks.heartbeat(task.id, this.options.workerId, this.now(), this.options.leaseSeconds);
    }, heartbeatMs);
    try {
      const outcome = await handler.handle(task);
      if (outcome.status === 'completed') {
        await this.tasks.complete(task.id, this.options.workerId, { status: 'completed' }, this.now());
      } else if (outcome.status === 'dead_letter') {
        await this.tasks.complete(task.id, this.options.workerId, { status: 'dead_letter', error: outcome.reason }, this.now());
      } else if (task.attempts >= this.options.maxAttempts) {
        await this.tasks.complete(task.id, this.options.workerId, { status: 'dead_letter', error: outcome.reason ?? 'retry limit reached' }, this.now());
      } else {
        const retryAt = outcome.retryAt
          ? new Date(outcome.retryAt)
          : new Date(this.now().getTime() + this.backoffMs(task.attempts));
        await this.tasks.retry(task.id, this.options.workerId, retryAt, outcome.reason ?? 'retry requested', this.now());
      }
    } catch (error) {
      if (isRetryable(error) && task.attempts < this.options.maxAttempts) {
        await this.tasks.retry(
          task.id,
          this.options.workerId,
          new Date(this.now().getTime() + this.backoffMs(task.attempts)),
          errorMessage(error),
          this.now(),
        );
      } else {
        await this.tasks.complete(task.id, this.options.workerId, { status: 'dead_letter', error: errorMessage(error) }, this.now());
      }
    } finally {
      clearInterval(heartbeat);
    }
    return task;
  }

  private backoffMs(attempts: number): number {
    return this.options.baseBackoffMs * 2 ** Math.max(0, attempts - 1);
  }
}
