import { Module } from '@nestjs/common';
import { AgentModule } from './agent.module.js';

@Module({
  imports: [AgentModule],
})
export class LocalPlanningAgentModule {}
