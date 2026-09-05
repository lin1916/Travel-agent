import { ApplicationError, type ConversationEventPublisher } from '@travel/application';
import type { ConversationTurnEvent } from '@travel/contracts';
import { randomUUID } from 'node:crypto';

interface Subscriber {
  queue: ConversationTurnEvent[];
  resolve?: () => void;
  closed: boolean;
}

export class InMemoryConversationEventStore implements ConversationEventPublisher {
  private readonly events = new Map<string, ConversationTurnEvent[]>();
  private readonly owners = new Map<string, string>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  constructor(private readonly clock: { now(): Date; id(): string } = { now: () => new Date(), id: () => randomUUID() }) {}

  publish(conversationId: string, input: Parameters<ConversationEventPublisher['publish']>[1]): ConversationTurnEvent {
    const history = this.events.get(conversationId) ?? [];
    const eventId = input.eventId ?? this.clock.id();
    if (this.owners.has(eventId)) throw new Error(`conversation event already exists: ${eventId}`);
    const event: ConversationTurnEvent = {
      event_id: eventId,
      event_type: input.type,
      aggregate_type: 'conversation',
      aggregate_id: conversationId,
      ...(input.runId ? { run_id: input.runId } : {}),
      sequence: history.length + 1,
      schema_version: 1,
      occurred_at: input.occurredAt ?? this.clock.now().toISOString(),
      request_id: input.requestId ?? eventId,
      correlation_id: input.correlationId,
      redacted_payload: structuredClone(input.payload),
    };
    history.push(event);
    this.events.set(conversationId, history);
    this.owners.set(eventId, conversationId);
    for (const subscriber of this.subscribers.get(conversationId) ?? []) {
      subscriber.queue.push(structuredClone(event));
      subscriber.resolve?.();
      subscriber.resolve = undefined;
    }
    return structuredClone(event);
  }

  subscribe(conversationId: string, lastEventId?: string): AsyncIterable<ConversationTurnEvent> {
    const history = this.events.get(conversationId) ?? [];
    let start = 0;
    if (lastEventId) {
      if (this.owners.get(lastEventId) !== conversationId) throw new ApplicationError('validation_error', 'Last-Event-ID does not belong to conversation');
      start = history.findIndex(event => event.event_id === lastEventId) + 1;
    }
    const subscriber: Subscriber = { queue: history.slice(start).map(event => structuredClone(event)), closed: false };
    const subscribers = this.subscribers.get(conversationId) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(conversationId, subscribers);
    const close = () => {
      if (subscriber.closed) return;
      subscriber.closed = true;
      subscriber.resolve?.();
      subscriber.resolve = undefined;
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.subscribers.delete(conversationId);
    };
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (!subscriber.closed) {
              const event = subscriber.queue.shift();
              if (event) return { value: event, done: false as const };
              await new Promise<void>(resolve => { subscriber.resolve = resolve; });
            }
            return { value: undefined, done: true as const };
          },
          async return() { close(); return { value: undefined, done: true as const }; },
        };
      },
    };
  }

  delete(conversationId: string): void {
    for (const event of this.events.get(conversationId) ?? []) this.owners.delete(event.event_id);
    this.events.delete(conversationId);
    for (const subscriber of this.subscribers.get(conversationId) ?? []) {
      subscriber.closed = true;
      subscriber.resolve?.();
    }
    this.subscribers.delete(conversationId);
  }
}
