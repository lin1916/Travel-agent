import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApplicationError, PlanService, type PlanContext } from '@travel/application';
import { PlanCommandSchema } from '@travel/contracts';
import { z } from 'zod';
import { BUDGET_SERVICE, TRIP_SERVICE } from '../trips/trip.providers.js';

const commandBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  command: PlanCommandSchema,
}).strict();
const undoBodySchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

function actorId(value: string | undefined): string {
  if (!value) throw new ApplicationError('unauthorized', 'x-actor-id header is required');
  return value;
}

@Controller('v1/trips/:tripId/plans')
export class PlanController {
  constructor(
    @Inject(PlanService) private readonly plans: PlanService,
    @Inject(TRIP_SERVICE) private readonly trips: { get(id: string, ownerId: string): Promise<{ travelerCount: number }> },
    @Inject(BUDGET_SERVICE) private readonly budgets: { get(tripId: string): Promise<{ totalLimit?: { amountCents: number } }> },
  ) {}

  @Get('current')
  async current(@Headers('x-actor-id') actor: string | undefined, @Param('tripId') tripId: string) {
    const ownerId = actorId(actor);
    const context = await this.context(tripId, ownerId);
    return this.plans.current(tripId, ownerId, context);
  }

  @Post('commands')
  @HttpCode(200)
  async execute(@Headers('x-actor-id') actor: string | undefined, @Param('tripId') tripId: string, @Body() rawBody: unknown) {
    const ownerId = actorId(actor);
    const parsed = commandBodySchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid plan command');
    return this.plans.execute(tripId, ownerId, parsed.data.command, parsed.data.expectedVersion, await this.context(tripId, ownerId));
  }

  @Post('undo')
  @HttpCode(200)
  async undo(@Headers('x-actor-id') actor: string | undefined, @Param('tripId') tripId: string, @Body() rawBody: unknown) {
    const ownerId = actorId(actor);
    const parsed = undoBodySchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid undo request');
    return this.plans.undo(tripId, ownerId, parsed.data.expectedVersion, await this.context(tripId, ownerId));
  }

  private async context(tripId: string, ownerId: string): Promise<PlanContext> {
    const trip = await this.trips.get(tripId, ownerId);
    const budget = await this.budgets.get(tripId);
    return { travelerCount: trip.travelerCount, totalBudgetCents: budget.totalLimit?.amountCents ?? 0 };
  }
}
