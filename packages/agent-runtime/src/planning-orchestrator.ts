import { randomUUID } from 'node:crypto';
import type { AgentContext, StructuredAgentOutput, ToolCallSummary } from '@travel/contracts';
import type { CapabilityContext, CapabilityGateway } from '@travel/capability-gateway';
import { AgentRunStore, type AgentRunSnapshot } from './agent-run.js';
import type { LlmProvider } from './llm-provider.js';

export interface StartPlanningInput { tripId: string; userMessage: string; actorId?: string; currentTripVersion?: number }

export class PlanningOrchestrator {
  constructor(private readonly provider: LlmProvider, private readonly gateway: CapabilityGateway, private readonly store = new AgentRunStore()) {}

  async start(input: StartPlanningInput): Promise<AgentRunSnapshot> {
    const run = this.store.create({ tripId: input.tripId, actorId: input.actorId });
    return this.plan(run, input.userMessage, input.currentTripVersion ?? 1);
  }

  async resume(runId: string, userMessage: string, currentTripVersion = 1): Promise<AgentRunSnapshot> {
    const run = this.store.get(runId);
    if (!run) throw new Error('agent run not found');
    return this.plan(run, userMessage, currentTripVersion);
  }

  get(runId: string): AgentRunSnapshot | undefined { return this.store.get(runId); }

  private async plan(run: AgentRunSnapshot, userMessage: string, currentTripVersion: number): Promise<AgentRunSnapshot> {
    const context: AgentContext = { actorId: run.actorId, tripId: run.tripId, agentRunId: run.runId, userMessage, currentTripVersion, redactedOffers: [] };
    const output: StructuredAgentOutput = await this.provider.generatePlan(context);
    const baseContext: CapabilityContext = {
      actorId: run.actorId ?? 'anonymous', tripId: run.tripId, agentRunId: run.runId,
      correlationId: randomUUID(), requestedRisk: 'read', actorAuthenticated: Boolean(run.actorId),
      currentTripVersion, expectedTripVersion: currentTripVersion,
    };
    const summaries: ToolCallSummary[] = [];
    const results = await Promise.all(output.toolCalls.map(async call => {
      try {
        const result = await this.gateway.execute(call.toolName, baseContext, call.input);
        const record = result as { category?: { source?: string; updatedAt?: string }; source?: string; updatedAt?: string; kind?: string };
        summaries.push({ toolName: call.toolName, risk: 'read', status: 'completed', inputSummary: typeof call.input === 'object' && call.input ? { kind: (call.input as { kind?: string }).kind } : {}, resultSummary: { source: record.category?.source ?? record.source, updatedAt: record.category?.updatedAt ?? record.updatedAt, kind: record.kind }, correlationId: baseContext.correlationId });
        return record;
      } catch (error) {
        const detail = error as { code?: string; publicMessage?: string };
        summaries.push({ toolName: call.toolName, risk: 'read', status: 'blocked', resultSummary: { code: detail.code ?? 'unknown' }, correlationId: baseContext.correlationId });
        return undefined;
      }
    }));
    const sourceUpdates = results.filter(Boolean).map(result => `source=${result?.category?.source ?? result?.source ?? 'unknown'} updated=${result?.category?.updatedAt ?? result?.updatedAt ?? 'unknown'} risk=read`);
    const status = output.missingFields.length ? 'awaiting_input' : 'completed';
    const assistantMessage = sourceUpdates.length ? `${output.assistantMessage} ${sourceUpdates.join('; ')}` : output.assistantMessage;
    return this.store.save({ ...run, ...output, assistantMessage, status, toolCallSummaries: [...run.toolCallSummaries, ...summaries], toolCalls: output.toolCalls, nextStep: output.missingFields.length ? 'request_missing_fields' : undefined });
  }
}

export { AgentRunStore } from './agent-run.js';
