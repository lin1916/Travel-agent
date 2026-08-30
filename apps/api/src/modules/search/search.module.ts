import { Module } from '@nestjs/common';
import { SearchService } from '@travel/application';
import { MockAttractionAdapter, MockDiningAdapter, MockStayAdapter, MockTransportAdapter } from '@travel/supplier-adapters';
import { TripModule } from '../trips/trip.module.js';
import { SearchController } from './search.controller.js';
import { SEARCH_SERVICE } from './search.tokens.js';

@Module({
  imports: [TripModule],
  controllers: [SearchController],
  providers: [
    {
      provide: SEARCH_SERVICE,
      useFactory: () => new SearchService({ train: new MockTransportAdapter(), stay: new MockStayAdapter(), attraction: new MockAttractionAdapter(), dining: new MockDiningAdapter() }),
    },
  ],
})
export class SearchModule {}
