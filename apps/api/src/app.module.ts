import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { TripModule } from './modules/trips/trip.module.js';
import { ItineraryModule } from './modules/itinerary/itinerary.module.js';
import { BudgetModule } from './modules/budget/budget.module.js';

@Module({
  imports: [TripModule, ItineraryModule, BudgetModule],
  controllers: [HealthController],
})
export class AppModule {}
