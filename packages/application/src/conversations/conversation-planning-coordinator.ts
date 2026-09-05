import type { PlanningContext, PlanningContextPatch } from '@travel/contracts';
import { PlanningContextService } from '../planning-context/planning-context-service.js';
import { TripService } from '../trips/trip-service.js';

export class ConversationPlanningCoordinator {
  constructor(
    private readonly planningContexts: PlanningContextService,
    private readonly trips: TripService,
    private readonly budgets?: { initialize(tripId: string, totalBudgetCents: number): Promise<unknown> | unknown },
  ) {}

  async applyAndEnsureTrip(input: {
    sessionId: string;
    conversationId: string;
    currentTripId?: string;
    expectedContextVersion: number;
    patch: PlanningContextPatch;
  }): Promise<{ context: PlanningContext; trip?: { id: string; version: number; ownerId: string } }> {
    const context = await this.planningContexts.applyPatch(input.sessionId, input.conversationId, input.patch, input.expectedContextVersion);
    if (input.currentTripId) {
      return { context, trip: await this.trips.get(input.currentTripId, input.sessionId) };
    }
    const draft = this.planningContexts.tripDraft(context);
    if (!draft) return { context };
    const trip = await this.trips.create(input.sessionId, draft, {
      idempotencyKey: `conversation:${input.conversationId}:planning-context:${context.version}`,
      totalBudgetCents: draft.totalBudgetCents,
    });
    await this.budgets?.initialize(trip.id, draft.totalBudgetCents);
    return { context, trip };
  }
}
