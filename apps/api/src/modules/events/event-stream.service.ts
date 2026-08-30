import { EventEnvelopeSchema, type EventEnvelope } from '@travel/contracts';
import { assertDurablePayloadSafe, EventRepository } from '@travel/persistence';

export interface StreamEvent {
  position: number;
  envelope: EventEnvelope;
}

export interface EventHistory {
  ownsTrip(actorId: string, tripId: string): Promise<boolean>;
  replay(tripId: string, lastEventId?: string): Promise<{ events: StreamEvent[]; cursor: number }>;
  follow(tripId: string, afterPosition: number): AsyncIterable<StreamEvent>;
}

export interface EventStream {
  subscribe(tripId: string, lastEventId?: string): AsyncIterable<EventEnvelope>;
}

function publicEnvelope(input: EventEnvelope): EventEnvelope {
  const envelope = EventEnvelopeSchema.parse(input);
  assertDurablePayloadSafe(envelope.redacted_payload, 'event.redacted_payload');
  return envelope;
}

export class EventStreamService {
  constructor(private readonly history: EventHistory) {}

  forActor(actorId: string): EventStream {
    return {
      subscribe: (tripId, lastEventId) => this.subscribe(actorId, tripId, lastEventId),
    };
  }

  private async *subscribe(actorId: string, tripId: string, lastEventId?: string): AsyncIterable<EventEnvelope> {
    if (!actorId || !await this.history.ownsTrip(actorId, tripId)) {
      throw new Error('actor is not authorized for Trip event stream');
    }
    const replay = await this.history.replay(tripId, lastEventId);
    let cursor = replay.cursor;
    for (const event of replay.events) {
      cursor = Math.max(cursor, event.position);
      yield publicEnvelope(event.envelope);
    }
    for await (const event of this.history.follow(tripId, cursor)) {
      cursor = Math.max(cursor, event.position);
      yield publicEnvelope(event.envelope);
    }
  }
}

export class PostgresEventHistory implements EventHistory {
  constructor(private readonly events: EventRepository, private readonly pollIntervalMs = 1_000) {}
  ownsTrip(actorId: string, tripId: string): Promise<boolean> { return this.events.ownsTrip(actorId, tripId); }
  replay(tripId: string, lastEventId?: string) { return this.events.replayTrip(tripId, lastEventId); }
  async *follow(tripId: string, afterPosition: number): AsyncIterable<StreamEvent> {
    let cursor = afterPosition;
    while (true) {
      const events = await this.events.tripEventsAfter(tripId, cursor);
      if (events.length === 0) {
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
        continue;
      }
      for (const event of events) {
        cursor = event.position;
        yield event;
      }
    }
  }
}
