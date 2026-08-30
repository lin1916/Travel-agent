import { Module } from '@nestjs/common';
import { SearchService } from '@travel/application';
import { CapabilityGateway } from '@travel/capability-gateway';
import { PlanningOrchestrator, RuleBasedProvider, createPlanningTools } from '@travel/agent-runtime';
import { AgentRunRepository, createDatabase } from '@travel/persistence';
import { SearchModule } from '../search/search.module.js';
import { TripModule } from '../trips/trip.module.js';
import { SEARCH_SERVICE } from '../search/search.tokens.js';
import { AgentController } from './agent.controller.js';
import { AGENT_ORCHESTRATOR } from './agent.tokens.js';
import { TRIP_SERVICE } from '../trips/trip.providers.js';

@Module({
  imports: [SearchModule, TripModule],
  controllers: [AgentController],
  providers: [
    {
      provide: AGENT_ORCHESTRATOR,
      inject: [SEARCH_SERVICE, TRIP_SERVICE],
      useFactory: (searchService: SearchService, tripService: { getAny(id: string): Promise<{ id: string; version: number; ownerId: string } | null> }) => {
        if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') throw new Error('DATABASE_URL is required for durable agent runs');
        const persistence = process.env.DATABASE_URL ? new AgentRunRepository(createDatabase()) : undefined;
        return new PlanningOrchestrator(new RuleBasedProvider(), new CapabilityGateway(createPlanningTools(searchService)), persistence, tripService);
      },
    },
  ],
  exports: [AGENT_ORCHESTRATOR],
})
export class AgentModule {}
