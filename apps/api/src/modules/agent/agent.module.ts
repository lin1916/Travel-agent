import { Module } from '@nestjs/common';
import { SearchService } from '@travel/application';
import { CapabilityGateway } from '@travel/capability-gateway';
import { PlanningOrchestrator, RuleBasedProvider, createPlanningTools } from '@travel/agent-runtime';
import { SearchModule } from '../search/search.module.js';
import { SEARCH_SERVICE } from '../search/search.tokens.js';
import { AgentController } from './agent.controller.js';
import { AGENT_ORCHESTRATOR } from './agent.tokens.js';

@Module({
  imports: [SearchModule],
  controllers: [AgentController],
  providers: [
    {
      provide: AGENT_ORCHESTRATOR,
      inject: [SEARCH_SERVICE],
      useFactory: (searchService: SearchService) => new PlanningOrchestrator(new RuleBasedProvider(), new CapabilityGateway(createPlanningTools(searchService))),
    },
  ],
  exports: [AGENT_ORCHESTRATOR],
})
export class AgentModule {}
