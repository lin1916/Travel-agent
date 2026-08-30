import type { TaskOutcome } from '@travel/contracts';
import type { TaskHandler, TaskRecord } from '../task-runner.js';

export interface BookingTaskExecutor {
  execute(taskId: string, payload: unknown): Promise<void>;
}

export class BookingJob implements TaskHandler {
  readonly kind = 'booking' as const;
  constructor(private readonly executor: BookingTaskExecutor) {}
  async handle(task: TaskRecord): Promise<TaskOutcome> {
    await this.executor.execute(task.id, task.payload);
    return { status: 'completed' };
  }
}
