import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module.js';
import { HealthController } from './health/health.controller.js';
import { LocalPlanningAgentModule } from './modules/agent/local-planning-agent.module.js';
import { BudgetModule } from './modules/budget/budget.module.js';
import { ItineraryModule } from './modules/itinerary/itinerary.module.js';
import { MapModule } from './modules/map/map.module.js';
import { PlanModule } from './modules/plans/plan.module.js';
import { CandidateModule } from './modules/candidates/candidate.module.js';
import { ProposalModule } from './modules/proposals/proposal.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { TripModule } from './modules/trips/trip.module.js';

@Module({
  imports: [
    DatabaseModule,
    TripModule,
    ItineraryModule,
    BudgetModule,
    SearchModule,
    LocalPlanningAgentModule,
    MapModule,
    CandidateModule,
    ProposalModule,
    PlanModule,
  ],
  controllers: [HealthController],
})
export class LocalPlanningAppModule {}
