import { Controller, Headers, MessageEvent, Param, Sse, UnauthorizedException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { EventStreamService } from './event-stream.service.js';

@Controller('/v1/trips')
export class EventController {
  constructor(private readonly streams: EventStreamService) {}

  @Sse(':tripId/events')
  events(
    @Param('tripId') tripId: string,
    @Headers('x-actor-id') actorId: string | undefined,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    if (!actorId) throw new UnauthorizedException('actor identity is required');
    const iterator = this.streams.forActor(actorId).subscribe(tripId, lastEventId)[Symbol.asyncIterator]();
    return new Observable<MessageEvent>(subscriber => {
      let active = true;
      void (async () => {
        try {
          while (active) {
            const next = await iterator.next();
            if (next.done) break;
            subscriber.next({ id: next.value.event_id, type: next.value.event_type, data: next.value });
          }
          if (active) subscriber.complete();
        } catch (error) {
          if (active) subscriber.error(error);
        }
      })();
      return () => {
        active = false;
        void iterator.return?.();
      };
    });
  }
}
