import { Controller, Get, Headers, Inject, Param } from '@nestjs/common';
import { ApplicationError, type PersistentBudgetService, type TripService } from '@travel/application';
import { BUDGET_SERVICE, TRIP_SERVICE } from '../trips/trip.providers.js';

@Controller('v1/trips/:tripId/budget')
export class BudgetController {
  constructor(@Inject(TRIP_SERVICE) private readonly tripService: TripService, @Inject(BUDGET_SERVICE) private readonly budgetService: PersistentBudgetService) {}
  @Get()
  async get(
    @Headers('x-actor-id') actor: string | undefined,
    @Param('tripId') tripId: string,
  ) {
    if (!actor) throw new ApplicationError('unauthorized');
    await this.tripService.get(tripId, actor);
    return this.budgetService.get(tripId);
  }
}
