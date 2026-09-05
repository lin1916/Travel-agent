import type { AgentContext, StructuredAgentOutput } from '@travel/contracts';

export interface LlmTurnMessage { role: 'user' | 'assistant'; content: string }
export interface LlmToolResult {
  toolName: string;
  correlationId: string;
  status: 'completed' | 'blocked';
  result: Record<string, unknown>;
}
export interface LlmTurnInput extends AgentContext {
  messages: LlmTurnMessage[];
  toolResults: LlmToolResult[];
  onEvent?: (event: unknown) => Promise<void> | void;
}
export type LlmTurnOutput = StructuredAgentOutput;

export interface LlmProvider {
  generatePlan(input: LlmTurnInput): Promise<LlmTurnOutput>;
}
