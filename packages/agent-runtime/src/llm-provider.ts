import type { AgentContext, StructuredAgentOutput } from '@travel/contracts';

export interface LlmProvider {
  generatePlan(input: AgentContext): Promise<StructuredAgentOutput>;
}
