import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type StreamFn } from '@earendil-works/pi-agent-core';
import type { Message, Models, Model, ToolResultMessage } from '@earendil-works/pi-ai';
import type { CapabilityGateway } from '@travel/capability-gateway';
import type { StructuredAgentOutput } from '@travel/contracts';
import type { LlmProvider, LlmTurnInput } from './llm-provider.js';
import { redactForModel, createPiTravelTools, type PiTravelToolContext } from './pi-travel-tools.js';
import { redactUserMessage } from './agent-run.js';
import { assertPlanProposalBinding, ModelProtocolError, normalizeStrictOutput, planningOutputJsonSchema, StructuredPlanningOutputSchema } from './responses-provider.js';

export interface PiPlanningProviderOptions {
  models: Models;
  model: Model<any>;
  streamFn?: StreamFn;
  gateway: CapabilityGateway;
  tools?: AgentTool[];
  toolFactory?: (context: PiTravelToolContext) => AgentTool[];
  onEvent?: (event: AgentEvent) => Promise<void> | void;
}

function toMessage(input: LlmTurnInput, model: Model<any>): AgentMessage[] {
  const priorMessages = input.messages.map(message => {
    const content = redactForModel(redactUserMessage(message.content));
    return { role: message.role, content: typeof content === 'string' ? content : '[REDACTED]' };
  });
  const toolResults = input.toolResults.map(result => ({
    toolName: result.toolName,
    correlationId: result.correlationId,
    status: result.status,
    result: redactForModel(result.result),
  }));
  const planningContext = redactForModel({
    actorId: input.actorId,
    requestId: input.requestId,
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    tripId: input.tripId,
    agentRunId: input.agentRunId,
    userMessage: redactUserMessage(input.userMessage),
    currentTripVersion: input.currentTripVersion,
    planningContext: input.planningContext,
    requestedRisk: input.requestedRisk ?? 'read',
    redactedOffers: input.redactedOffers,
    priorMessages,
    toolResults,
  });
  const messages: AgentMessage[] = [{
    role: 'user',
    content: [{ type: 'text', text: JSON.stringify({ travelPlanningContext: planningContext }) }],
    timestamp: Date.now(),
  } as AgentMessage];
  messages.push(...priorMessages.map((message): AgentMessage => {
    const content = [{ type: 'text' as const, text: message.content }];
    if (message.role === 'user') return { role: 'user', content, timestamp: Date.now() };
    return {
      role: 'assistant', content, timestamp: Date.now(), api: model.api, provider: model.provider, model: model.id,
      stopReason: 'stop',
      // Restored public messages have no provider usage; zero lets Pi estimate the context from text.
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
  }));
  for (const result of toolResults) {
    messages.push({
      role: 'toolResult', toolCallId: result.correlationId, toolName: result.toolName,
      content: [{ type: 'text', text: JSON.stringify(result.result) }], details: result.result,
      isError: result.status !== 'completed', timestamp: Date.now(),
    } as ToolResultMessage);
  }
  return messages;
}

export class PiModelRequestError extends Error {
  readonly retryable = true;

  constructor() {
    super('Pi model request failed');
    this.name = 'PiModelRequestError';
  }
}

function textOf(message: AgentMessage): string {
  if (!('content' in message) || !Array.isArray(message.content)) return '';
  return message.content.filter((item): item is { type: 'text'; text: string } => item.type === 'text').map(item => item.text).join('');
}

function structuredText(text: string): StructuredAgentOutput | undefined {
  try {
    const parsed = StructuredPlanningOutputSchema.safeParse(normalizeStrictOutput(JSON.parse(text)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export class PiPlanningProvider implements LlmProvider {
  constructor(private readonly options: PiPlanningProviderOptions) {}

  async generatePlan(input: LlmTurnInput): Promise<StructuredAgentOutput> {
    const streamFn: StreamFn = this.options.streamFn ?? ((model, context, options) => this.options.models.streamSimple(model, context, options));
    const toolContext: PiTravelToolContext = {
      actorId: input.actorId,
      conversationId: input.conversationId,
      tripId: input.tripId,
      agentRunId: input.agentRunId,
      correlationId: input.correlationId,
      requestedRisk: input.requestedRisk,
      actorAuthenticated: Boolean(input.actorId),
      currentTripVersion: input.currentTripVersion,
      expectedTripVersion: input.currentTripVersion,
      planningContext: input.planningContext,
    };
    const agent = new Agent({
      streamFn,
      initialState: {
        model: this.options.model,
        systemPrompt: [
          'You are a safe China domestic travel planning coordinator. Reply to the user in Chinese.',
          'Use only registered read and prepare travel tools. Never invent availability, supplier pricing, places, routes, bookings, payments, supplier orders, or traveler data.',
          'Use native tool calls to update_planning_context for newly supplied travel conditions before searching. Use the returned current context version and Trip ID in subsequent operations.',
          'Ask for missing travel conditions rather than silently inventing them. Use +08:00 dates, CNY integer cents and verified GCJ-02 places. Current date: ' + new Date().toISOString().slice(0, 10) + '.',
          'Once conditions are sufficient, search verified places and return an itinerary in planProposal for user review. Only the user may accept it; never save candidates or a formal plan yourself.',
          'A stay item may span check-in to check-out and coexist with activities. All other itinerary items must be actual non-overlapping activity or transfer windows. Do not represent a whole-trip transport allowance as one multi-day transport item: allocate estimated costs to the relevant transfer windows, label them estimates, and leave buffer time. Budget totals must equal the sum of itinerary costs, multiplying only per_person costs by traveler count.',
          'After native tool calls finish, return ONLY one JSON object matching OUTPUT_SCHEMA, without markdown fences. Use assistantMessage for the conversational reply and reasoningSummary for a short user-facing explanation, never hidden chain-of-thought.',
          'Return toolCalls: [] and actionRequests: []; tools already ran natively. Set planningContextPatch to null after updating it through a tool. Set planProposal to null while required conditions are missing; otherwise bind it to the current Conversation, Trip and planning context version from tool results.',
          'OUTPUT_SCHEMA\n' + JSON.stringify(planningOutputJsonSchema('update_planning_context, search_places, list_candidate_places, search_offers, check_schedule, calculate_budget')),
        ].join('\n'),
        messages: toMessage(input.messages.length && input.messages[input.messages.length - 1]?.role === 'user' && input.messages[input.messages.length - 1]?.content === input.userMessage ? { ...input, messages: input.messages.slice(0, -1) } : input, this.options.model),
        tools: this.options.toolFactory?.(toolContext) ?? this.options.tools ?? createPiTravelTools(this.options.gateway, toolContext),
        thinkingLevel: 'off',
      },
      convertToLlm: messages => messages.filter((message): message is Message => message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'),
      toolExecution: 'parallel',
    });
    if (this.options.onEvent || input.onEvent) agent.subscribe(async event => {
      await this.options.onEvent?.(event);
      await input.onEvent?.(event);
    });
    try {
      await agent.prompt(redactUserMessage(input.userMessage));
    } catch {
      throw new PiModelRequestError();
    }
    const assistants = agent.state.messages.filter(message => message.role === 'assistant');
    const latest = assistants[assistants.length - 1];
    const latestRecord = latest as (AgentMessage & { stopReason?: string; errorMessage?: string }) | undefined;
    if (agent.state.errorMessage || latestRecord?.stopReason === 'error' || latestRecord?.stopReason === 'aborted' || !latest) throw new PiModelRequestError();
    const assistantMessage = latest ? textOf(latest) : '';
    const structured = structuredText(assistantMessage);
    if (!structured) throw new ModelProtocolError();
    input.tripId = toolContext.tripId;
    input.currentTripVersion = toolContext.currentTripVersion;
    input.planningContext = toolContext.planningContext ?? input.planningContext;
    assertPlanProposalBinding(structured, input);
    // Pi Agent executes the allow-listed tools internally. Returning those
    // calls would make PlanningOrchestrator replay them a second time.
    return { ...structured, toolCalls: [] };
  }
}
