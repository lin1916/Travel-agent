import { randomUUID } from 'node:crypto';
import type { AgentContext, AgentRunStatus, RiskLevel, StructuredAgentOutput, ToolCallSummary } from '@travel/contracts';
import type { CapabilityContext, CapabilityGateway } from '@travel/capability-gateway';
import { AgentRunStore, redactUserMessage, type AgentRunPersistence, type AgentRunSnapshot } from './agent-run.js';
import type { LlmProvider } from './llm-provider.js';

export interface StartPlanningInput {
  tripId: string;
  userMessage: string;
  actorId?: string;
  requestedRisk?: RiskLevel;
}

export interface TripVersionReader {
  getAny(tripId: string): Promise<{ id: string; version: number; ownerId: string } | null>;
}

export class PlanningOrchestrator {
  constructor(
    private readonly provider: LlmProvider,
    private readonly gateway: CapabilityGateway,
    private readonly store: AgentRunPersistence = new AgentRunStore(),
    private readonly tripReader?: TripVersionReader,
  ) {}

  async start(input: StartPlanningInput): Promise<AgentRunSnapshot> {
    const currentTripVersion = await this.authoritativeVersion(input.tripId, input.actorId);
    const safeMessage = redactUserMessage(input.userMessage);
    const run = this.newRun(input.tripId, input.actorId, safeMessage, currentTripVersion);
    await this.store.create(run);
    return this.plan(run, input.requestedRisk ?? 'read');
  }

  async resume(runId: string, userMessage: string, actorId?: string, requestedRisk: RiskLevel = 'read'): Promise<AgentRunSnapshot> {
    const run = await this.store.get(runId);
    if (!run) throw new Error('agent run not found');
    this.assertOwner(run, actorId);
    const currentTripVersion = await this.authoritativeVersion(run.tripId, run.actorId);
    if (currentTripVersion !== run.currentTripVersion) throw new Error('trip version changed');
    const next = { ...run, userMessage: redactUserMessage(userMessage), currentTripVersion };
    await this.store.save(next);
    return this.plan(next, requestedRisk);
  }

  async get(runId: string, actorId?: string): Promise<AgentRunSnapshot | undefined> {
    const run = await this.store.get(runId);
    if (!run) return undefined;
    this.assertOwner(run, actorId);
    return run;
  }

  private newRun(tripId: string, actorId: string | undefined, userMessage: string, currentTripVersion: number): AgentRunSnapshot {
    const now = new Date().toISOString();
    return {
      runId: randomUUID(), tripId, actorId, status: 'running', userMessage, currentTripVersion,
      assistantMessage: '', missingFields: [], toolCalls: [], actionRequests: [], toolCallSummaries: [], createdAt: now, updatedAt: now,
    };
  }

  private async authoritativeVersion(tripId: string, actorId?: string): Promise<number> {
    if (!this.tripReader) return 1;
    const trip = await this.tripReader.getAny(tripId);
    if (!trip) throw new Error('trip not found');
    if (actorId && trip.ownerId !== actorId) throw new Error('trip belongs to another actor');
    return trip.version;
  }

  private assertOwner(run: AgentRunSnapshot, actorId?: string): void {
    if (run.actorId ? run.actorId !== actorId : actorId !== undefined) throw new Error('agent run belongs to another actor');
  }

  private async plan(run: AgentRunSnapshot, requestedRisk: RiskLevel): Promise<AgentRunSnapshot> {
    const context: AgentContext = {
      actorId: run.actorId, tripId: run.tripId, agentRunId: run.runId, userMessage: run.userMessage,
      currentTripVersion: run.currentTripVersion, redactedOffers: [], requestedRisk,
    };
    const output: StructuredAgentOutput = await this.provider.generatePlan(context);
    const authoritativeTrip = this.tripReader ? await this.tripReader.getAny(run.tripId) : null;
    const summaries: ToolCallSummary[] = [];
    const results = await Promise.all(output.toolCalls.map(async call => {
      const correlationId = randomUUID();
      const baseContext: CapabilityContext = {
        actorId: run.actorId ?? 'anonymous', tripId: run.tripId, agentRunId: run.runId,
        correlationId, requestedRisk, actorAuthenticated: Boolean(run.actorId),
        tripOwnerId: run.actorId ? authoritativeTrip?.ownerId : undefined,
        currentTripVersion: run.currentTripVersion, expectedTripVersion: run.currentTripVersion,
      };
      try {
        const result = await this.gateway.execute(call.toolName, baseContext, call.input);
        const record = result as { category?: { source?: string; updatedAt?: string }; source?: string; updatedAt?: string; kind?: string };
        summaries.push({ toolName: call.toolName, risk: this.gateway.riskOf(call.toolName) ?? 'read', status: 'completed', inputSummary: this.safeInputSummary(call.input), resultSummary: { source: record.category?.source ?? record.source, updatedAt: record.category?.updatedAt ?? record.updatedAt, kind: record.kind }, correlationId });
        return record;
      } catch (error) {
        const detail = error as { code?: string };
        summaries.push({ toolName: call.toolName, risk: this.gateway.riskOf(call.toolName) ?? 'read', status: 'blocked', inputSummary: this.safeInputSummary(call.input), resultSummary: { code: detail.code ?? 'unknown' }, correlationId });
        return undefined;
      }
    }));
    const sourceUpdates = results.filter(Boolean).map(result => `source=${result?.category?.source ?? result?.source ?? 'unknown'} updated=${result?.category?.updatedAt ?? result?.updatedAt ?? 'unknown'} risk=${requestedRisk}`);
    const actionRequests = [...output.actionRequests];
    if ((requestedRisk === 'commit' || requestedRisk === 'redirect') && actionRequests.length === 0) actionRequests.push({ kind: 'confirmation_required', resourceId: run.tripId });
    const status: AgentRunStatus = output.missingFields.length || actionRequests.length ? 'awaiting_input' : 'completed';
    const assistantMessage = sourceUpdates.length ? `${output.assistantMessage} ${sourceUpdates.join('; ')}` : output.assistantMessage;
    const updated = { ...run, assistantMessage, missingFields: output.missingFields, actionRequests, status, toolCalls: output.toolCalls.map(call => ({ toolName: call.toolName, input: this.safeCallInput(call.input) })), toolCallSummaries: [...run.toolCallSummaries, ...summaries], nextStep: output.missingFields.length ? 'request_missing_fields' : actionRequests.length ? 'awaiting_confirmation' : undefined };
    const saved = await this.store.save(updated);
    return saved && typeof saved === 'object' ? saved : updated;
  }

  private safeInputSummary(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object') return {};
    const record = input as Record<string, unknown>;
    return { kind: typeof record.kind === 'string' ? record.kind : undefined };
  }

  private safeCallInput(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object') return {};
    const record = input as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    for (const key of ['tripId', 'kind', 'origin', 'destination', 'startsAt', 'endsAt', 'travelers']) {
      const value = record[key];
      if (typeof value === 'string' || typeof value === 'number') safe[key] = value;
    }
    return safe;
  }
}

export { AgentRunStore } from './agent-run.js';
