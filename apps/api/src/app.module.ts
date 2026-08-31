import { Module } from '@nestjs/common';
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

@Module({
  imports: [TripModule, ItineraryModule, BudgetModule, SearchModule, AgentModule, AuthModule, TravelerModule, MandateModule, ActionRequestModule, BookingModule, WebhookModule, EventModule, OrderModule, AuditModule, MetricsModule],
  controllers: [HealthController],
})
export class AppModule {}

