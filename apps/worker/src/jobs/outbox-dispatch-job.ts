import type { EventEnvelope, TaskOutcome } from '@travel/contracts';
import type { TaskHandler, TaskRecord } from '../task-runner.js';

export interface DispatchableOutbox {
  pending(limit?: number): Promise<EventEnvelope[]>;
  markPublished(eventId: string): Promise<void>;
}

export interface EventConsumerInbox {
  claim(consumerName: string, eventId: string, owner: string, claimedAt: Date, leaseSeconds: number, externalEventId?: string): Promise<'claimed' | 'busy' | 'completed'>;
  complete(consumerName: string, eventId: string, owner: string, completedAt: Date): Promise<boolean>;
  release(consumerName: string, eventId: string, owner: string): Promise<void>;
}

export interface EventConsumer {
  name: string;
  deliver(event: EventEnvelope): Promise<void>;
}

export class OutboxDispatchJob implements TaskHandler {
  readonly kind = 'outbox_dispatch' as const;

  constructor(
    private readonly outbox: DispatchableOutbox,
    private readonly inbox: EventConsumerInbox,
    private readonly consumer: EventConsumer,
    private readonly options: { now?: () => Date; claimLeaseSeconds?: number } = {},
  ) {}

  async handle(task: TaskRecord): Promise<TaskOutcome> {
    const now = this.options.now ?? (() => new Date());
    const leaseSeconds = this.options.claimLeaseSeconds ?? 30;
    for (const event of await this.outbox.pending()) {
      const state = await this.inbox.claim(this.consumer.name, event.event_id, task.id, now(), leaseSeconds);
      if (state === 'busy') return { status: 'retry', reason: 'outbox delivery claim is busy' };
      if (state === 'claimed') {
        try {
          await this.consumer.deliver(event);
        } catch (error) {
          await this.inbox.release(this.consumer.name, event.event_id, task.id);
          throw error;
        }
        if (!await this.inbox.complete(this.consumer.name, event.event_id, task.id, now())) {
          throw Object.assign(new Error('outbox delivery claim expired before completion'), { retryable: true });
        }
      }
      await this.outbox.markPublished(event.event_id);
    }
    return { status: 'completed' };
  }
}
