import { Controller, Get, Headers, Inject, Param } from '@nestjs/common';
import { ApplicationError, type PersistentItineraryService, type TripService } from '@travel/application';
import { ITINERARY_SERVICE, TRIP_SERVICE } from '../trips/trip.providers.js';

@Controller('v1/trips/:tripId/itinerary')
export class ItineraryController {
  constructor(@Inject(TRIP_SERVICE) private readonly tripService: TripService, @Inject(ITINERARY_SERVICE) private readonly itineraryService: PersistentItineraryService) {}
  @Get()
  async list(
    @Headers('x-actor-id') actor: string | undefined,
    @Param('tripId') tripId: string,
  ) {
    if (!actor) throw new ApplicationError('unauthorized');
    await this.tripService.get(tripId, actor);
    return (await this.itineraryService.list(tripId)).items;
  }
}
