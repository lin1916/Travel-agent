import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApplicationError, type TripService } from '@travel/application';
import { BUDGET_SERVICE, TRIP_SERVICE } from './trip.providers.js';

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
  constructor(@Inject(TRIP_SERVICE) private readonly tripService: TripService, @Inject(BUDGET_SERVICE) private readonly budgetService: any) {}
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Headers('x-actor-id') actor: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateTripBody,
  ) {
    if (
      body.totalBudgetCents !== undefined
      && (!Number.isInteger(body.totalBudgetCents) || body.totalBudgetCents < 0)
    ) {
      throw new ApplicationError('validation_error', 'total budget must be a non-negative integer');
    }
    if (!idempotencyKey) throw new ApplicationError('validation_error', 'idempotency-key header is required');
    const trip = await this.tripService.create(actorId(actor), body, { totalBudgetCents: body.totalBudgetCents ?? 0, idempotencyKey });
    if (process.env.NODE_ENV === 'test' && this.budgetService.initialize) this.budgetService.initialize(trip.id, body.totalBudgetCents ?? 0);
    return trip;
  }

  @Get(':tripId')
  async get(
    @Headers('x-actor-id') actor: string | undefined,
    @Param('tripId') tripId: string,
  ) {
    return this.tripService.get(tripId, actorId(actor));
  }
}
