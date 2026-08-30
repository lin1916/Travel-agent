import type { EventEnvelope, TaskOutcome } from '@travel/contracts';
import type { TaskHandler, TaskRecord } from '../task-runner.js';

export interface DispatchableOutbox {
  pending(limit?: number): Promise<EventEnvelope[]>;
  markPublished(eventId: string): Promise<void>;
}

export interface EventConsumerInbox {
  claim(consumerName: string, eventId: string, externalEventId?: string): Promise<boolean>;
  release(consumerName: string, eventId: string): Promise<void>;
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
  ) {}

  async handle(_task: TaskRecord): Promise<TaskOutcome> {
    for (const event of await this.outbox.pending()) {
      if (await this.inbox.claim(this.consumer.name, event.event_id)) {
        try {
          await this.consumer.deliver(event);
        } catch (error) {
          await this.inbox.release(this.consumer.name, event.event_id);
          throw error;
        }
      }
      await this.outbox.markPublished(event.event_id);
    }
    return { status: 'completed' };
  }
}
