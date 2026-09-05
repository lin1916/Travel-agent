import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApplicationError, ConversationService, PlanService, type PlanContext } from '@travel/application';
import { z } from 'zod';
import { AnonymousSessionGuard } from './anonymous-session.js';
import { BUDGET_SERVICE, TRIP_SERVICE } from '../trips/trip.providers.js';

interface SessionRequest { anonymousSessionId?: string }
const undoSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

@Controller('v1/conversations/:conversationId')
@UseGuards(AnonymousSessionGuard)
export class ConversationPlanController {
  constructor(
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(PlanService) private readonly plans: PlanService,
    @Inject(TRIP_SERVICE) private readonly trips: { get(id: string, ownerId: string): Promise<{ id: string; travelerCount: number }> },
    @Inject(BUDGET_SERVICE) private readonly budgets: { get(tripId: string): Promise<{ totalLimit?: { amountCents: number } }> | { totalLimit?: { amountCents: number } } },
  ) {}

  @Get('plan')
  async current(@Req() request: SessionRequest, @Param('conversationId') conversationId: string) {
    const sessionId = request.anonymousSessionId;
    if (!sessionId) throw new ApplicationError('unauthorized');
    const conversation = await this.conversations.get(sessionId, conversationId);
    if (!conversation.tripId) return { plan: null, currentVersion: 0 };
    const trip = await this.trips.get(conversation.tripId, sessionId);
    const budget = await this.budgets.get(conversation.tripId);
    const context: PlanContext = { travelerCount: trip.travelerCount, totalBudgetCents: budget.totalLimit?.amountCents ?? 0 };
    const current = await this.plans.currentAccepted(conversation.tripId, sessionId, context);
    return { plan: current.plan ?? null, currentVersion: current.currentVersion };
  }

  @Post('plan/undo')
  @HttpCode(200)
  async undo(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Body() body: unknown) {
    const sessionId = request.anonymousSessionId;
    if (!sessionId) throw new ApplicationError('unauthorized');
    const conversation = await this.conversations.get(sessionId, conversationId);
    const parsed = undoSchema.safeParse(body);
    if (!parsed.success) throw new ApplicationError('validation_error', 'invalid undo request');
    if (!conversation.tripId) throw new ApplicationError('validation_error', 'there is no accepted plan to undo');
    const trip = await this.trips.get(conversation.tripId, sessionId);
    const budget = await this.budgets.get(conversation.tripId);
    const context: PlanContext = { travelerCount: trip.travelerCount, totalBudgetCents: budget.totalLimit?.amountCents ?? 0 };
    const current = await this.plans.currentAccepted(conversation.tripId, sessionId, context);
    if (!current.plan) throw new ApplicationError('validation_error', 'there is no accepted plan to undo');
    return this.plans.undo(conversation.tripId, sessionId, parsed.data.expectedVersion, context);
  }
}
