import { Controller, Get, Headers, Param } from '@nestjs/common';
import { ApplicationError } from '@travel/application';
import { budgetService, tripService } from '../trips/trip.state.js';

@Controller('v1/trips/:tripId/budget')
export class BudgetController {
  @Get()
  async get(
    @Headers('x-actor-id') actor: string | undefined,
    @Param('tripId') tripId: string,
  ) {
    if (!actor) throw new ApplicationError('unauthorized');
    await tripService.get(tripId, actor);
    return budgetService.get(tripId);
  }
}
