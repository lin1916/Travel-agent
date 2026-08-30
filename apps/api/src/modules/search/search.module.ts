import { Module } from '@nestjs/common';
import { InMemorySearchTaskQueue, SearchService } from '@travel/application';
import { createDatabase, TaskRepository } from '@travel/persistence';
import { MockAttractionAdapter, MockDiningAdapter, MockStayAdapter, MockTransportAdapter } from '@travel/supplier-adapters';
import { TripModule } from '../trips/trip.module.js';
import { SearchController } from './search.controller.js';
import { SEARCH_SERVICE } from './search.tokens.js';

export const SEARCH_TASK_QUEUE = Symbol('SEARCH_TASK_QUEUE');

@Module({
  imports: [TripModule],
  controllers: [SearchController],
  providers: [
    {
      provide: SEARCH_TASK_QUEUE,
      useFactory: () => process.env.DATABASE_URL ? new TaskRepository(createDatabase()) : new InMemorySearchTaskQueue(),
    },
    {
      provide: SEARCH_SERVICE,
      inject: [SEARCH_TASK_QUEUE],
      useFactory: (taskQueue: InMemorySearchTaskQueue | TaskRepository) => {
        const transport = new MockTransportAdapter();
        return new SearchService({ train: transport, flight: transport, stay: new MockStayAdapter(), attraction: new MockAttractionAdapter(), dining: new MockDiningAdapter() }, taskQueue);
      },
    },
  ],
  exports: [SEARCH_SERVICE],
})
export class SearchModule {}
