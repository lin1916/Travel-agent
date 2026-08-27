import { Controller, Get, Headers, Param } from '@nestjs/common';
import { ApplicationError } from '@travel/application';
import { itineraryService, tripService } from '../trips/trip.state.js';

@Controller('v1/trips/:tripId/itinerary')
export class ItineraryController {
  @Get()
  async list(
    @Headers('x-actor-id') actor: string | undefined,
    @Param('tripId') tripId: string,
  ) {
    if (!actor) throw new ApplicationError('unauthorized');
    await tripService.get(tripId, actor);
    return itineraryService.list(tripId);
  }
}
