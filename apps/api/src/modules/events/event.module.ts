import { Module, ServiceUnavailableException } from '@nestjs/common';
import { createDatabase, EventRepository } from '@travel/persistence';
import { EventController } from './event.controller.js';
import { EventStreamService, PostgresEventHistory, type EventHistory } from './event-stream.service.js';

class UnavailableEventHistory implements EventHistory {
  private unavailable(): never { throw new ServiceUnavailableException('durable event history is unavailable'); }
  async ownsTrip(): Promise<boolean> { return this.unavailable(); }
  async replay(): Promise<{ events: never[]; cursor: number }> { return this.unavailable(); }
  async *follow(): AsyncIterable<never> { this.unavailable(); }
}

@Module({
  controllers: [EventController],
  providers: [{
    provide: EventStreamService,
    useFactory: () => {
      if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'test') return new EventStreamService(new UnavailableEventHistory());
      const db = createDatabase();
      return new EventStreamService(new PostgresEventHistory(new EventRepository(db)));
    },
  }],
})
export class EventModule {}
