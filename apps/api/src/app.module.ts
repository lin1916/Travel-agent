import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { TripModule } from './modules/trips/trip.module.js';
import { ItineraryModule } from './modules/itinerary/itinerary.module.js';
import { BudgetModule } from './modules/budget/budget.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TravelerModule } from './modules/travelers/traveler.module.js';

@Module({
  imports: [TripModule, ItineraryModule, BudgetModule, SearchModule, AgentModule, AuthModule, TravelerModule],
  controllers: [HealthController],
})
export class AppModule {}
