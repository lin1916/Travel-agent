import { randomUUID } from 'node:crypto';
import type { AgentRunStatus, PlanningContext, PlanningContextPatch, RiskLevel, StructuredAgentOutput, ToolCallSummary } from '@travel/contracts';
import type { CapabilityContext, CapabilityGateway } from '@travel/capability-gateway';
import { AgentRunStore, redactUserMessage, type AgentRunPersistence, type AgentRunSnapshot } from './agent-run.js';
import type { LlmProvider, LlmToolResult, LlmTurnInput, LlmTurnMessage } from './llm-provider.js';
import { PiPlanningProvider, type PiPlanningProviderOptions } from './pi-planning-provider.js';
import { createPiTravelTools } from './pi-travel-tools.js';
import { assertPlanProposalBinding, createPlanningProvider, ModelConfigurationError, ModelProtocolError } from './responses-provider.js';
import { resolveAgentRuntimeConfig } from './runtime-config.js';
import { createModels, createProvider, type Model, type Provider } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';

export interface StartPlanningInput {
  conversationId?: string;
  tripId?: string;
  userMessage: string;
  planningContext?: PlanningContext;
  actorId?: string;
  requestedRisk?: RiskLevel;
  requestId?: string;
  correlationId?: string;
  messages?: LlmTurnMessage[];
  onEvent?: PlanningLifecyclePublisher;
}

export interface PlanningLifecycleEvent {
  type: 'AgentTurnStarted' | 'PlanningContextUpdated' | 'ReasoningSummaryUpdated' | 'ToolCallStarted' | 'ToolCallCompleted' | 'ToolCallFailed' | 'PlanProposalCreated' | 'AgentMessageCompleted' | 'AgentTurnFailed';
  runId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}
export type PlanningLifecyclePublisher = (event: PlanningLifecycleEvent) => Promise<void> | void;

export interface PlanningMetrics {
  toolCalls: { inc(value?: number, labels?: Record<string, string>): void };
  supplierErrors: { inc(value?: number, labels?: Record<string, string>): void };
  supplierLatency: { observe(value: number, labels?: Record<string, string>): void };
  modelLatency?: { observe(value: number, labels?: Record<string, string>): void };
  /** @deprecated use modelLatency; retained for compatibility with existing injectors. */
  modelCost?: { observe(value: number, labels?: Record<string, string>): void };
}

export interface PlanningRuntimeDependencies {
  gateway: CapabilityGateway;
  store?: AgentRunPersistence;
  tripReader?: TripVersionReader;
  metrics?: PlanningMetrics;
  legacyProvider?: LlmProvider;
  pi?: Pick<PiPlanningProviderOptions, 'models' | 'model' | 'streamFn' | 'tools'>;
}

export interface PlanningRuntime {
  provider: LlmProvider;
  gateway: CapabilityGateway;
  store?: AgentRunPersistence;
  tripReader?: TripVersionReader;
  metrics?: PlanningMetrics;
}

function createPiRuntimeOptions(environment: NodeJS.ProcessEnv): Pick<PiPlanningProviderOptions, 'models' | 'model'> {
  const config = resolveAgentRuntimeConfig(environment);
  if (!config.piEnabled) throw new ModelConfigurationError('Pi runtime is unavailable on the current Node.js version');
  if (!config.apiKeyConfigured) throw new ModelConfigurationError('Pi runtime requires a configured model API key');
  const builtin = getBuiltinModels('openai');
  const selected = builtin.find(candidate => candidate.id === config.model);
  if (!selected) throw new ModelConfigurationError(`Pi model ${config.model} is unavailable`);
  const model = { ...selected, baseUrl: config.baseUrl } as Model<any>;
  const provider: Provider = createProvider({
    id: 'openai', name: 'Travel LLM', baseUrl: config.baseUrl,
    auth: {
      apiKey: {
        name: 'Travel LLM API key',
        resolve: async () => ({ auth: { apiKey: config.apiKeyConfigured ? environment.TRAVEL_LLM_API_KEY!.trim() : undefined }, source: 'TRAVEL_LLM_API_KEY' }),
      },
    },
    models: [model], api: openAIResponsesApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  return { models, model };
}

export function createPlanningRuntime(environment: NodeJS.ProcessEnv = process.env, dependencies: PlanningRuntimeDependencies): PlanningRuntime {
  const config = resolveAgentRuntimeConfig(environment);
  const provider = config.mode === 'pi'
    ? new PiPlanningProvider({ ...createPiRuntimeOptions(environment), ...dependencies.pi, gateway: dependencies.gateway, toolFactory: context => createPiTravelTools(dependencies.gateway, context) })
    : dependencies.legacyProvider ?? createPlanningProvider(environment);
  return { provider, gateway: dependencies.gateway, store: dependencies.store, tripReader: dependencies.tripReader, metrics: dependencies.metrics };
}

export interface TripVersionReader {
  getAny(tripId: string): Promise<{ id: string; version: number; ownerId: string } | null>;
}

interface ExecutedTool {
  llmResult: LlmToolResult;
  rawResult?: unknown;
}

interface PlanningUpdateResult {
  context: PlanningContext;
  trip?: { id: string; version: number; ownerId: string };
}

function patchChangesContext(context: PlanningContext, patch: PlanningContextPatch): boolean {
  return Object.entries(patch).some(([key, value]) => JSON.stringify(context[key as keyof PlanningContext]) !== JSON.stringify(value));
}

function isPlanningUpdateResult(value: unknown): value is PlanningUpdateResult {
  if (!value || typeof value !== 'object') return false;
  const context = (value as { context?: unknown }).context;
  return Boolean(context && typeof context === 'object' && typeof (context as { version?: unknown }).version === 'number' && Array.isArray((context as { missingFields?: unknown }).missingFields));
}

export class PlanningOrchestrator {
  constructor(
    private readonly provider: LlmProvider,
    private readonly gateway: CapabilityGateway,
    private readonly store: AgentRunPersistence = new AgentRunStore(),
    private readonly tripReader?: TripVersionReader,
    private readonly metrics?: PlanningMetrics,
  ) {}

  async start(input: StartPlanningInput): Promise<AgentRunSnapshot> {
    if (!input.conversationId && !input.tripId) throw new Error('conversationId or tripId is required');
    if (input.conversationId && input.planningContext && input.planningContext.conversationId !== input.conversationId) {
      throw new Error('planning context does not belong to the conversation');
    }
    const currentTripVersion = input.tripId ? await this.authoritativeVersion(input.tripId, input.actorId) : undefined;
    const safeMessage = redactUserMessage(input.userMessage);
    const requestId = input.requestId ?? randomUUID();
    const correlationId = input.correlationId ?? requestId;
    const run = this.newRun(input, safeMessage, currentTripVersion, requestId, correlationId);
    await this.store.create(run);
    return this.plan(run, input.requestedRisk ?? 'read', input.messages, input.onEvent);
  }

  async resume(runId: string, userMessage: string, actorId?: string, requestedRisk: RiskLevel = 'read', messages?: LlmTurnMessage[], onEvent?: PlanningLifecyclePublisher): Promise<AgentRunSnapshot> {
    const run = await this.store.get(runId);
    if (!run) throw new Error('agent run not found');
    this.assertOwner(run, actorId);
    const currentTripVersion = run.tripId ? await this.authoritativeVersion(run.tripId, run.actorId) : undefined;
    if (run.tripId && currentTripVersion !== run.currentTripVersion) throw new Error('trip version changed');
    const next = { ...run, userMessage: redactUserMessage(userMessage), currentTripVersion };
    await this.store.save(next);
    return this.plan(next, requestedRisk, messages, onEvent);
  }

  async get(runId: string, actorId?: string): Promise<AgentRunSnapshot | undefined> {
    const run = await this.store.get(runId);
    if (!run) return undefined;
    this.assertOwner(run, actorId);
    return run;
  }

  private newRun(input: StartPlanningInput, userMessage: string, currentTripVersion: number | undefined, requestId: string, correlationId: string): AgentRunSnapshot {
    const now = new Date().toISOString();
    const planningContext = input.planningContext ?? {
      conversationId: input.conversationId ?? '',
      version: 1,
      preferences: [],
      assumptions: [],
      missingFields: ['destination', 'startsAt', 'endsAt', 'travelerCount'],
      updatedAt: now,
    };
    return {
      runId: randomUUID(), conversationId: input.conversationId, tripId: input.tripId, actorId: input.actorId, requestId, correlationId,
      status: 'running', userMessage, currentTripVersion, planningContext,
      assistantMessage: '', missingFields: [], toolCalls: [], actionRequests: [], planProposal: null, toolCallSummaries: [], createdAt: now, updatedAt: now,
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

  private async plan(initialRun: AgentRunSnapshot, requestedRisk: RiskLevel, messages?: LlmTurnMessage[], onEvent?: PlanningLifecyclePublisher): Promise<AgentRunSnapshot> {
    let run = initialRun;
    let authoritativeTrip = run.tripId && this.tripReader ? await this.tripReader.getAny(run.tripId) : null;
    const context: LlmTurnInput = {
      actorId: run.actorId, requestId: run.requestId, correlationId: run.correlationId, conversationId: run.conversationId, tripId: run.tripId,
      agentRunId: run.runId, userMessage: run.userMessage, currentTripVersion: run.currentTripVersion, planningContext: run.planningContext,
      redactedOffers: [], requestedRisk,
      messages: (messages ?? [{ role: 'user', content: run.userMessage }]).map(message => ({ ...message, content: redactUserMessage(message.content) })),
      toolResults: [],
      ...(onEvent ? { onEvent: (event: unknown) => this.publishPiEvent(onEvent, run, event) } : {}),
    };
    const summaries: ToolCallSummary[] = [];
    const exposedCalls: Array<{ toolName: string; input: Record<string, unknown> }> = [];
    const turnCorrelationId = run.correlationId ?? run.requestId ?? run.runId;
    await this.publish(onEvent, { type: 'AgentTurnStarted', runId: run.runId, correlationId: turnCorrelationId, payload: { turnId: run.runId } });
    let output: StructuredAgentOutput;
    let rounds = 0;
    while (true) {
      const modelStartedAt = Date.now();
      try {
        output = await this.provider.generatePlan(context);
        assertPlanProposalBinding(output, context);
      } catch (error) {
        const code = error instanceof ModelProtocolError ? 'model_protocol_error' : 'model_request_failed';
        const retryable = error instanceof ModelProtocolError ? false : (error as { retryable?: unknown }).retryable !== false;
        const failed = { ...run, status: 'failed' as const, assistantMessage: '', nextStep: 'retry' };
        await this.store.save(failed);
        await this.publish(onEvent, { type: 'AgentTurnFailed', runId: run.runId, correlationId: turnCorrelationId, payload: { retryable, code } });
        throw error;
      }
      (this.metrics?.modelLatency ?? this.metrics?.modelCost)?.observe(Date.now() - modelStartedAt, { risk: requestedRisk });
      if (context.tripId !== run.tripId || context.currentTripVersion !== run.currentTripVersion || context.planningContext.version !== run.planningContext.version) {
        const tripCreated = !run.tripId && Boolean(context.tripId);
        run = { ...run, tripId: context.tripId, currentTripVersion: context.currentTripVersion, planningContext: context.planningContext };
        await this.store.save(run);
        await this.publishPlanningContext(onEvent, run, tripCreated);
      }
      if (output.reasoningSummary) {
        const reasoningSummary = this.safeText(output.reasoningSummary);
        run = { ...run, reasoningSummary };
        await this.publish(onEvent, { type: 'ReasoningSummaryUpdated', runId: run.runId, correlationId: turnCorrelationId, payload: { summary: reasoningSummary } });
      }
      const toolCalls = run.conversationId && output.planningContextPatch && patchChangesContext(context.planningContext, output.planningContextPatch)
        && !output.toolCalls.some(call => call.toolName === 'update_planning_context')
        ? [{ toolName: 'update_planning_context', input: { expectedContextVersion: context.planningContext.version, patch: output.planningContextPatch } }, ...output.toolCalls]
        : output.toolCalls;
      if (toolCalls.length === 0) break;
      if (rounds >= 8) {
        const failed = {
          ...run, status: 'failed' as const, assistantMessage: 'The planning run reached its tool limit. Please retry with a narrower request.',
          missingFields: [], actionRequests: [], toolCalls: exposedCalls, toolCallSummaries: [...run.toolCallSummaries, ...summaries], nextStep: 'retry',
        };
        const saved = await this.store.save(failed);
        await this.publish(onEvent, { type: 'AgentTurnFailed', runId: run.runId, correlationId: turnCorrelationId, payload: { retryable: true, code: 'tool_round_limit' } });
        return saved && typeof saved === 'object' ? saved : failed;
      }
      exposedCalls.push(...toolCalls.map(call => ({ toolName: call.toolName, input: this.safeCallInput(call.input) })));
      const executed = await Promise.all(toolCalls.map(call => this.executeTool(call, run, requestedRisk, authoritativeTrip, summaries, onEvent)));
      context.toolResults = executed.map(item => item.llmResult);
      for (let index = 0; index < executed.length; index += 1) {
        const call = toolCalls[index];
        const result = executed[index]?.rawResult;
        if (call?.toolName !== 'update_planning_context' || !isPlanningUpdateResult(result)) continue;
        const tripCreated = !run.tripId && Boolean(result.trip);
        if (result.trip) authoritativeTrip = result.trip;
        run = { ...run, planningContext: result.context, tripId: result.trip?.id ?? run.tripId, currentTripVersion: result.trip?.version ?? run.currentTripVersion };
        context.planningContext = result.context;
        context.tripId = run.tripId;
        context.currentTripVersion = run.currentTripVersion;
        await this.store.save(run);
        await this.publishPlanningContext(onEvent, run, tripCreated);
      }
      rounds += 1;
    }
    const actionRequests = [...output.actionRequests];
    if ((requestedRisk === 'commit' || requestedRisk === 'redirect') && actionRequests.length === 0 && run.tripId) actionRequests.push({ kind: 'confirmation_required', resourceId: run.tripId });
    const status: AgentRunStatus = output.missingFields.length || actionRequests.length ? 'awaiting_input' : 'completed';
    const updated: AgentRunSnapshot = {
      ...run, assistantMessage: this.safeText(output.assistantMessage), reasoningSummary: output.reasoningSummary ? this.safeText(output.reasoningSummary) : run.reasoningSummary,
      planProposal: output.planProposal, missingFields: output.missingFields, actionRequests, status, toolCalls: exposedCalls,
      toolCallSummaries: [...run.toolCallSummaries, ...summaries],
      nextStep: output.missingFields.length ? 'request_missing_fields' : actionRequests.length ? 'awaiting_confirmation' : undefined,
    };
    const saved = await this.store.save(updated);
    const finalRun = saved && typeof saved === 'object' ? saved : updated;
    if (output.planProposal) {
      await this.publish(onEvent, {
        type: 'PlanProposalCreated', runId: run.runId, correlationId: turnCorrelationId,
        payload: { itemCount: output.planProposal.itinerary.length, estimatedTotalCents: output.planProposal.budgetSummary.estimatedTotal.amountCents },
      });
    }
    await this.publish(onEvent, { type: 'AgentMessageCompleted', runId: run.runId, correlationId: turnCorrelationId, payload: { messageId: randomUUID() } });
    return finalRun;
  }

  private async executeTool(call: StructuredAgentOutput['toolCalls'][number], run: AgentRunSnapshot, requestedRisk: RiskLevel, authoritativeTrip: Awaited<ReturnType<TripVersionReader['getAny']>>, summaries: ToolCallSummary[], onEvent?: PlanningLifecyclePublisher): Promise<ExecutedTool> {
    const correlationId = run.correlationId ? `${run.correlationId}:${call.toolName}` : randomUUID();
    const startedAt = Date.now();
    this.metrics?.toolCalls.inc(1, { tool: call.toolName });
    const baseContext: CapabilityContext = {
      actorId: run.actorId ?? 'anonymous', conversationId: run.conversationId, tripId: run.tripId, agentRunId: run.runId,
      correlationId, requestedRisk, actorAuthenticated: Boolean(run.actorId), tripOwnerId: run.tripId && run.actorId ? authoritativeTrip?.ownerId : undefined,
      currentTripVersion: run.currentTripVersion, expectedTripVersion: run.currentTripVersion,
    };
    await this.publish(onEvent, { type: 'ToolCallStarted', runId: run.runId, correlationId, payload: { toolName: call.toolName } });
    try {
      const result = await this.gateway.execute(call.toolName, baseContext, call.input);
      this.metrics?.supplierLatency.observe(Date.now() - startedAt, { tool: call.toolName });
      const metadata = this.toolResultMetadata(result);
      summaries.push({ toolName: call.toolName, risk: this.gateway.riskOf(call.toolName) ?? 'read', status: 'completed', inputSummary: this.safeInputSummary(call.input), resultSummary: metadata, correlationId });
      await this.publish(onEvent, { type: 'ToolCallCompleted', runId: run.runId, correlationId, payload: { toolName: call.toolName, ...metadata } });
      return { llmResult: { toolName: call.toolName, correlationId, status: 'completed', result: this.redactToolResult(result) }, rawResult: result };
    } catch (error) {
      this.metrics?.supplierErrors.inc(1, { tool: call.toolName });
      const detail = error as { code?: string; retryable?: boolean };
      const code = detail.code ?? 'unknown';
      const retryable = detail.retryable === true;
      summaries.push({ toolName: call.toolName, risk: this.gateway.riskOf(call.toolName) ?? 'read', status: 'blocked', inputSummary: this.safeInputSummary(call.input), resultSummary: { code }, correlationId });
      await this.publish(onEvent, { type: 'ToolCallFailed', runId: run.runId, correlationId, payload: { toolName: call.toolName, code, retryable } });
      return { llmResult: { toolName: call.toolName, correlationId, status: 'blocked', result: { code } } };
    }
  }

  private async publishPlanningContext(publisher: PlanningLifecyclePublisher | undefined, run: AgentRunSnapshot, tripCreated: boolean): Promise<void> {
    const context = run.planningContext;
    const populatedFields = ['destination', 'origin', 'startsAt', 'endsAt', 'travelerCount', 'totalBudgetCents', 'preferences']
      .filter(field => {
        const value = context[field as keyof PlanningContext];
        return Array.isArray(value) ? value.length > 0 : value !== undefined;
      });
    await this.publish(publisher, {
      type: 'PlanningContextUpdated', runId: run.runId, correlationId: run.correlationId ?? run.requestId ?? run.runId,
      payload: { version: context.version, populatedFields, missingFields: context.missingFields, tripCreated },
    });
  }

  private async publish(publisher: PlanningLifecyclePublisher | undefined, event: PlanningLifecycleEvent): Promise<void> {
    await publisher?.(event);
  }

  private async publishPiEvent(publisher: PlanningLifecyclePublisher | undefined, run: AgentRunSnapshot, event: unknown): Promise<void> {
    if (!event || typeof event !== 'object') return;
    const record = event as Record<string, unknown>;
    const type = record.type;
    if (type !== 'tool_execution_start' && type !== 'tool_execution_end') return;
    const toolName = typeof record.toolName === 'string' ? record.toolName : 'unknown';
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : toolName;
    const correlationId = `${run.correlationId ?? run.requestId ?? run.runId}:${toolCallId}`;
    await this.publish(publisher, {
      type: type === 'tool_execution_start' ? 'ToolCallStarted' : record.isError ? 'ToolCallFailed' : 'ToolCallCompleted',
      runId: run.runId, correlationId,
      payload: type === 'tool_execution_start' ? { toolName } : record.isError ? { toolName, code: 'pi_tool_failed', retryable: false } : { toolName },
    });
  }

  private redactToolResult(value: unknown): Record<string, unknown> {
    const redact = (item: unknown, key = ''): unknown => {
      if (/(authorization|cookie|api.?key|token|secret|password|passport|payment|card|email|phone|traveler)/i.test(key)) return '[REDACTED]';
      if (typeof item === 'string') return redactUserMessage(item).replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
      if (Array.isArray(item)) return item.map(entry => redact(entry));
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([entryKey, entry]) => [entryKey, redact(entry, entryKey)]));
      return item;
    };
    const redacted = redact(value);
    return redacted && typeof redacted === 'object' && !Array.isArray(redacted) ? redacted as Record<string, unknown> : { value: redacted };
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

  private toolResultMetadata(value: unknown): { source?: string; resultCount?: number } {
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    const category = record.category && typeof record.category === 'object' ? record.category as Record<string, unknown> : undefined;
    const rawSource = typeof category?.source === 'string' ? category.source : typeof record.source === 'string' ? record.source : undefined;
    const source = rawSource ? this.safeText(rawSource) : undefined;
    const resultArray = [record.offers, record.places, record.candidates, record.ranked].find(Array.isArray);
    return { ...(source ? { source } : {}), ...(resultArray ? { resultCount: resultArray.length } : {}) };
  }

  private safeText(value: string): string {
    return redactUserMessage(value).replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  }
}

export { AgentRunStore } from './agent-run.js';
