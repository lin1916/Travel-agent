import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApplicationError } from '@travel/application';
import { budgetService, tripService } from './trip.state.js';

interface CreateTripBody {
  destination: string;
  startsAt: string;
  endsAt: string;
  travelerCount: number;
  totalBudgetCents?: number;
}

function actorId(value: string | undefined): string {
  if (!value) {
    throw new ApplicationError('unauthorized', 'x-actor-id header is required');
  }
  return value;
}

@Controller('v1/trips')
export class TripController {
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers('x-actor-id') actor: string | undefined,
    @Body() body: CreateTripBody,
  ) {
    if (
      body.totalBudgetCents !== undefined
      && (!Number.isInteger(body.totalBudgetCents) || body.totalBudgetCents < 0)
    ) {
      throw new ApplicationError('validation_error', 'total budget must be a non-negative integer');
    }
    const trip = await tripService.create(actorId(actor), body);
    budgetService.initialize(trip.id, body.totalBudgetCents ?? 0);
    return trip;
  }

  @Get(':tripId')
  async get(
    @Headers('x-actor-id') actor: string | undefined,
    @Param('tripId') tripId: string,
  ) {
    return tripService.get(tripId, actorId(actor));
  }
}
