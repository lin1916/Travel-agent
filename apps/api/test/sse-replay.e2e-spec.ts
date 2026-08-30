import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@travel/contracts';
import {
  EventStreamService,
  type EventHistory,
  type StreamEvent,
} from '../src/modules/events/event-stream.service.js';

function envelope(id: string, sequence: number, payload: Record<string, unknown> = {}): EventEnvelope {
  return {
    event_id: id,
    event_type: 'TripUpdated',
    aggregate_type: 'Trip',
    aggregate_id: 'trip-1',
    sequence,
    schema_version: 1,
    occurred_at: `2026-08-30T12:00:0${sequence}.000Z`,
    request_id: `request-${sequence}`,
    correlation_id: 'correlation-1',
    redacted_payload: payload,
  };
}

class FixedEventHistory implements EventHistory {
  constructor(
    private readonly history: StreamEvent[],
    private readonly live: StreamEvent[] = [],
  ) {}

  async ownsTrip(actorId: string, tripId: string) {
    return actorId === 'actor-1' && tripId === 'trip-1';
  }

  async replay(tripId: string, lastEventId?: string) {
    if (tripId !== 'trip-1') return { events: [], cursor: 0 };
    const index = lastEventId ? this.history.findIndex(event => event.envelope.event_id === lastEventId) : -1;
    if (lastEventId && index < 0) throw new Error('Last-Event-ID does not belong to Trip');
    const events = this.history.slice(index + 1);
    const cursor = events.at(-1)?.position ?? (index >= 0 ? this.history[index]!.position : 0);
    return { events, cursor };
  }

  async *follow(_tripId: string, afterPosition: number) {
    for (const event of this.live) if (event.position > afterPosition) yield event;
  }
}

async function collect(stream: AsyncIterable<EventEnvelope>): Promise<EventEnvelope[]> {
  const result: EventEnvelope[] = [];
  for await (const event of stream) result.push(event);
  return result;
}

describe('Trip SSE replay', () => {
  it('authorizes actor and Trip, replays after Last-Event-ID, then follows ordered events', async () => {
    const history = new FixedEventHistory(
      [{ position: 10, envelope: envelope('event-1', 1) }, { position: 11, envelope: envelope('event-2', 2) }],
      [{ position: 12, envelope: envelope('event-3', 3) }],
    );
    const stream = new EventStreamService(history).forActor('actor-1');

    const events = await collect(stream.subscribe('trip-1', 'event-1'));

    expect(events.map(event => event.event_id)).toEqual(['event-2', 'event-3']);
    expect(events.map(event => event.sequence)).toEqual([2, 3]);
    expect(Object.keys(events[0]!).sort()).toEqual([
      'aggregate_id', 'aggregate_type', 'correlation_id', 'event_id', 'event_type', 'occurred_at',
      'redacted_payload', 'request_id', 'schema_version', 'sequence',
    ]);
  });

  it('refuses replay when the actor does not own the Trip', async () => {
    const stream = new EventStreamService(new FixedEventHistory([{ position: 1, envelope: envelope('event-1', 1) }])).forActor('actor-2');
    await expect(collect(stream.subscribe('trip-1'))).rejects.toThrow(/not authorized/i);
  });

  it('rejects a supposedly redacted envelope containing traveler plaintext fields', async () => {
    const unsafe = envelope('event-unsafe', 1, { fullName: 'plaintext-value' });
    const stream = new EventStreamService(new FixedEventHistory([{ position: 1, envelope: unsafe }])).forActor('actor-1');
    await expect(collect(stream.subscribe('trip-1'))).rejects.toThrow(/sensitive payload field/i);
  });
});
