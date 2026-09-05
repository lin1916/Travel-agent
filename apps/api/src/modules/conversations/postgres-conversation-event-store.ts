import { randomUUID } from 'node:crypto';
import type { ConversationTurnEvent } from '@travel/contracts';
import type { ConversationEventPublisher } from '@travel/application';
import { ApplicationError } from '@travel/application';
import { EventRepository } from '@travel/persistence';

export class PostgresConversationEventStore implements ConversationEventPublisher {
  constructor(private readonly events: EventRepository) {}

  async publish(conversationId: string, input: Parameters<ConversationEventPublisher['publish']>[1]): Promise<ConversationTurnEvent> {
    const eventId = input.eventId ?? randomUUID();
    const event = await this.events.append({
      event_id: eventId,
      event_type: input.type,
      aggregate_type: 'conversation',
      aggregate_id: conversationId,
      ...(input.runId ? { run_id: input.runId } : {}),
      schema_version: 1,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      request_id: input.requestId ?? eventId,
      correlation_id: input.correlationId,
      redacted_payload: input.payload,
    });
    return event as ConversationTurnEvent;
  }

  async *subscribe(conversationId: string, lastEventId?: string): AsyncIterable<ConversationTurnEvent> {
    let cursor = 0;
    if (lastEventId) {
      const event = await this.events.conversationEvent(lastEventId);
      if (!event || event.envelope.aggregate_id !== conversationId) throw new ApplicationError('validation_error', 'Last-Event-ID does not belong to conversation');
      cursor = event.position;
    }
    while (true) {
      const pending = await this.events.conversationEventsAfter(conversationId, cursor);
      if (pending.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      for (const event of pending) {
        cursor = event.position;
        yield event.envelope as ConversationTurnEvent;
      }
    }
  }

  delete(conversationId: string): Promise<void> {
    return this.events.deleteConversationEvents(conversationId);
  }
}
