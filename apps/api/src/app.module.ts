import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module.js';
import { HealthController } from './health/health.controller.js';
import { TripModule } from './modules/trips/trip.module.js';
import { ItineraryModule } from './modules/itinerary/itinerary.module.js';
import { BudgetModule } from './modules/budget/budget.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TravelerModule } from './modules/travelers/traveler.module.js';
import { MandateModule } from './modules/mandates/mandate.module.js';
import { ActionRequestModule } from './modules/action-requests/action-request.module.js';
import { BookingModule } from './modules/bookings/booking.module.js';
import { EventModule } from './modules/events/event.module.js';
import { OrderModule } from './modules/orders/order.module.js';
import { WebhookModule } from './modules/webhooks/webhook.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { ConversationModule } from './modules/conversations/conversation.module.js';
import { MapModule } from './modules/map/map.module.js';
import { PlanModule } from './modules/plans/plan.module.js';
import { LocalPlanningAppModule } from './local-planning-app.module.js';
import { isLocalPlanningMemoryMode } from './local-planning-memory-mode.js';
import { CandidateModule } from './modules/candidates/candidate.module.js';
import { ProposalModule } from './modules/proposals/proposal.module.js';

@Module({
  imports: [DatabaseModule, TripModule, ItineraryModule, BudgetModule, SearchModule, AgentModule, ConversationModule, MapModule, CandidateModule, ProposalModule, PlanModule, AuthModule, TravelerModule, MandateModule, ActionRequestModule, BookingModule, WebhookModule, EventModule, OrderModule, AuditModule, MetricsModule],
  controllers: [HealthController],
})
export class AppModule {}

export function selectApiRootModule(environment: NodeJS.ProcessEnv = process.env) {
  return isLocalPlanningMemoryMode(environment) ? LocalPlanningAppModule : AppModule;
}

