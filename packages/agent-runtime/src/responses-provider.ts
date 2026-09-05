import { z } from 'zod';
import {
  PlanProposalDraftSchema,
  PlanningContextPatchSchema,
  type StructuredAgentOutput,
} from '@travel/contracts';
import type { LlmProvider, LlmTurnInput } from './llm-provider.js';
import { assertOutboundUrl, isAllowedOutboundUrlResolved, supplierRequestOptions } from '@travel/security';

export const StructuredPlanningOutputSchema = z.object({
  assistantMessage: z.string(),
  planningContextPatch: PlanningContextPatchSchema.nullable(),
  reasoningSummary: z.string().trim().min(1).max(4_000).optional(),
  missingFields: z.array(z.enum(['destination', 'startsAt', 'endsAt', 'travelerCount'])),
  toolCalls: z.array(z.object({
    toolName: z.string().min(1),
    input: z.record(z.unknown()),
  }).strict()),
  actionRequests: z.array(z.object({
    kind: z.string().min(1),
    resourceId: z.string().min(1),
  }).strict()),
  planProposal: PlanProposalDraftSchema.nullable(),
}).strict();

export interface ResponsesProviderConfig {
  baseUrl: string;
  responsesPath: string;
  apiKey: string;
  model: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  timeoutMs: number;
  fetch: typeof fetch;
  allowlist?: readonly string[];
}

export class ModelConfigurationError extends Error {
  constructor(message = 'real model configuration is incomplete') {
    super(message);
    this.name = 'ModelConfigurationError';
  }
}

export class ModelRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRequestError';
  }
}

export class ModelProtocolError extends Error {
  constructor(message = 'model response did not contain valid structured planning output') {
    super(message);
    this.name = 'ModelProtocolError';
  }
}

export function assertPlanProposalBinding(output: StructuredAgentOutput, input: Pick<LlmTurnInput, 'conversationId' | 'tripId' | 'planningContext'>): void {
  const proposal = output.planProposal;
  if (!proposal) return;
  if (
    !input.conversationId || proposal.conversationId !== input.conversationId ||
    !input.tripId || proposal.tripId !== input.tripId ||
    proposal.planningContextVersion !== input.planningContext.version
  ) throw new ModelProtocolError('model proposal does not match the active planning context');
}

const reasoningEfforts = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;

function isReasoningEffort(value: string): value is ResponsesProviderConfig['reasoningEffort'] {
  return (reasoningEfforts as readonly string[]).includes(value);
}

function assertConfigured(config: Omit<ResponsesProviderConfig, 'fetch'>): void {
  if (!config.baseUrl.trim() || !config.responsesPath.trim() || !config.apiKey.trim() || !config.model.trim()) {
    throw new ModelConfigurationError();
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) throw new ModelConfigurationError();
  if (!isReasoningEffort(config.reasoningEffort)) throw new ModelConfigurationError();
}

export function createPlanningProvider(environment: NodeJS.ProcessEnv = process.env): LlmProvider {
  const reasoningEffort = environment.TRAVEL_LLM_REASONING_EFFORT ?? 'xhigh';
  if (!isReasoningEffort(reasoningEffort)) throw new ModelConfigurationError();
  const config: Omit<ResponsesProviderConfig, 'fetch'> = {
    baseUrl: environment.TRAVEL_LLM_BASE_URL ?? 'https://apizh-ai.com',
    responsesPath: environment.TRAVEL_LLM_RESPONSES_PATH ?? '/responses',
    apiKey: environment.TRAVEL_LLM_API_KEY ?? '',
    model: environment.TRAVEL_LLM_MODEL ?? 'gpt-5.5',
    reasoningEffort,
    timeoutMs: Number(environment.TRAVEL_LLM_TIMEOUT_MS ?? '60000'),
  };
  assertConfigured(config);
  return new ThirdPartyResponsesProvider({ ...config, fetch: globalThis.fetch });
}

function endpoint(config: Pick<ResponsesProviderConfig, 'baseUrl' | 'responsesPath'>): string {
  return `${config.baseUrl.replace(/\/+$/, '')}/${config.responsesPath.replace(/^\/+/, '')}`;
}

function outputText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  if (!Array.isArray(record.output)) return undefined;
  for (const item of record.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === 'output_text' && typeof partRecord.text === 'string') return partRecord.text;
    }
  }
  return undefined;
}

const conversationToolNames = 'update_planning_context, search_places, list_candidate_places, search_offers';
const directTripToolNames = `${conversationToolNames}, add_itinerary_item, move_itinerary_item, remove_itinerary_item, replace_itinerary_item, lock_itinerary_item, optimize_day, check_schedule, calculate_budget, undo_plan_change`;

function modelToolNames(input: Pick<LlmTurnInput, 'conversationId'>): string {
  return input.conversationId ? conversationToolNames : directTripToolNames;
}

const planningLocationJsonSchema = {
  type: 'object', additionalProperties: false, required: ['city', 'latitude', 'longitude'],
  properties: {
    city: { type: 'string' }, latitude: { type: ['number', 'null'] }, longitude: { type: ['number', 'null'] },
  },
} as const;

const planningContextPatchJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['destination', 'origin', 'startsAt', 'endsAt', 'travelerCount', 'totalBudgetCents', 'preferences', 'assumptions'],
  properties: {
    destination: { type: ['string', 'null'] }, origin: { type: ['string', 'null'] },
    startsAt: { type: ['string', 'null'], pattern: '\\+08:00$' },
    endsAt: { type: ['string', 'null'], pattern: '\\+08:00$' },
    travelerCount: { type: ['integer', 'null'], minimum: 1, maximum: 6 }, totalBudgetCents: { type: ['integer', 'null'], minimum: 0 },
    preferences: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
    assumptions: { anyOf: [{ type: 'array', items: { type: 'string', enum: ['traveler_count_defaulted_to_1'] } }, { type: 'null' }] },
  },
} as const;

const planningItemJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['category', 'title', 'startsAt', 'endsAt', 'location', 'offerId', 'estimatedCostCents', 'priceScope'],
  properties: {
    category: { type: 'string', enum: ['transport', 'stay', 'attraction', 'dining'] },
    title: { type: 'string' }, startsAt: { type: 'string', pattern: '\\+08:00$' }, endsAt: { type: 'string', pattern: '\\+08:00$' },
    location: { anyOf: [planningLocationJsonSchema, { type: 'null' }] }, offerId: { type: ['string', 'null'] },
    estimatedCostCents: { type: 'integer', minimum: 0 }, priceScope: { type: 'string', enum: ['group', 'per_person'] },
  },
} as const;

const planningMoneyJsonSchema = {
  type: 'object', additionalProperties: false, required: ['amountCents', 'currency'],
  properties: { amountCents: { type: 'integer', minimum: 0 }, currency: { type: 'string', enum: ['CNY'] } },
} as const;

const planningBudgetJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['limit', 'estimatedTotal', 'groupTotal', 'perPerson', 'byCategory', 'utilizationPercent', 'warnings'],
  properties: {
    limit: planningMoneyJsonSchema, estimatedTotal: planningMoneyJsonSchema, groupTotal: planningMoneyJsonSchema, perPerson: planningMoneyJsonSchema,
    byCategory: {
      type: 'object', additionalProperties: false, required: ['transport', 'stay', 'attraction', 'dining'],
      properties: {
        transport: { anyOf: [planningMoneyJsonSchema, { type: 'null' }] }, stay: { anyOf: [planningMoneyJsonSchema, { type: 'null' }] },
        attraction: { anyOf: [planningMoneyJsonSchema, { type: 'null' }] }, dining: { anyOf: [planningMoneyJsonSchema, { type: 'null' }] },
      },
    },
    utilizationPercent: { type: 'number', minimum: 0 },
    warnings: { type: 'array', items: { type: 'string', enum: ['budget_80_percent', 'budget_exceeded'] } },
  },
} as const;

const planningPlaceJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'category', 'address', 'city', 'latitude', 'longitude', 'location', 'coordinateSystem', 'provider', 'providerPlaceId', 'sourceUpdatedAt'],
  properties: {
    id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' },
    latitude: { type: 'number' }, longitude: { type: 'number' }, location: { type: 'object', additionalProperties: false, required: ['latitude', 'longitude', 'coordinateSystem'], properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, coordinateSystem: { type: 'string', enum: ['GCJ-02'] } } },
    coordinateSystem: { type: 'string', enum: ['gcj02'] }, provider: { type: 'string', enum: ['amap'] }, providerPlaceId: { type: 'string' }, sourceUpdatedAt: { type: 'string' },
  },
} as const;

const planningProposalJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['conversationId', 'tripId', 'planningContextVersion', 'proposedPlaces', 'itinerary', 'budgetSummary', 'warnings', 'reasoningSummary', 'expiresAt'],
  properties: {
    conversationId: { type: 'string' }, tripId: { type: 'string' }, planningContextVersion: { type: 'integer', minimum: 1 },
    proposedPlaces: { type: 'array', items: planningPlaceJsonSchema }, itinerary: { type: 'array', items: planningItemJsonSchema },
    budgetSummary: planningBudgetJsonSchema, warnings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['code', 'message', 'severity'], properties: { code: { type: 'string', enum: ['transfer_tight', 'airport_advance', 'rhythm'] }, message: { type: 'string' }, severity: { type: 'string', enum: ['info', 'warning'] } } } },
    reasoningSummary: { type: ['string', 'null'] }, expiresAt: { type: 'string' },
  },
} as const;
const planningToolInputJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['tripId', 'kind', 'origin', 'destination', 'startsAt', 'endsAt', 'travelers', 'budgetLimit', 'expectedContextVersion', 'patch', 'expectedVersion', 'item', 'itemId', 'location', 'locked', 'day', 'query'],
  properties: {
    tripId: { type: ['string', 'null'] }, kind: { anyOf: [{ type: 'string', enum: ['train', 'flight', 'stay', 'attraction', 'dining'] }, { type: 'null' }] },
    origin: { type: ['string', 'null'] }, destination: { type: ['string', 'null'] }, startsAt: { type: ['string', 'null'] }, endsAt: { type: ['string', 'null'] },
    travelers: { type: ['integer', 'null'], minimum: 1, maximum: 6 }, budgetLimit: { anyOf: [planningMoneyJsonSchema, { type: 'null' }] },
    expectedContextVersion: { type: ['integer', 'null'], minimum: 1 }, patch: { anyOf: [planningContextPatchJsonSchema, { type: 'null' }] },
    expectedVersion: { type: ['integer', 'null'], minimum: 1 }, item: { anyOf: [planningItemJsonSchema, { type: 'null' }] }, itemId: { type: ['string', 'null'] },
    location: { anyOf: [planningLocationJsonSchema, { type: 'null' }] }, locked: { type: ['boolean', 'null'] }, day: { type: ['string', 'null'] }, query: { type: ['string', 'null'] },
  },
} as const;

export function planningOutputJsonSchema(toolNames: string) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assistantMessage', 'planningContextPatch', 'reasoningSummary', 'missingFields', 'toolCalls', 'actionRequests', 'planProposal'],
    properties: {
      assistantMessage: { type: 'string' },
      planningContextPatch: { anyOf: [planningContextPatchJsonSchema, { type: 'null' }] },
      reasoningSummary: { type: ['string', 'null'] },
      missingFields: { type: 'array', items: { type: 'string', enum: ['destination', 'startsAt', 'endsAt', 'travelerCount'] } },
      toolCalls: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['toolName', 'input'],
          properties: {
            toolName: { type: 'string', enum: toolNames.split(', ') },
            input: planningToolInputJsonSchema,
          },
        },
      },
      actionRequests: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['kind', 'resourceId'],
          properties: { kind: { type: 'string' }, resourceId: { type: 'string' } },
        },
      },
      planProposal: { anyOf: [planningProposalJsonSchema, { type: 'null' }] },
    },
  } as const;
}


export function normalizeStrictOutput(value: unknown): unknown {
  const omitNullFields = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(omitNullFields);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .filter(([, entry]) => entry !== null)
        .map(([key, entry]) => [key, omitNullFields(entry)]),
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const normalized = omitNullFields(input) as Record<string, unknown>;
  if (input.planningContextPatch === null) normalized.planningContextPatch = null;
  if (input.planProposal === null) normalized.planProposal = null;
  return normalized;
}

export class ThirdPartyResponsesProvider implements LlmProvider {
  constructor(private readonly config: ResponsesProviderConfig) {}

  async generatePlan(input: LlmTurnInput): Promise<StructuredAgentOutput> {
    this.assertConfigured();
    const controller = new AbortController();
    const allowlist = this.config.allowlist?.length ? this.config.allowlist : [new URL(this.config.baseUrl).hostname];
    let target: URL;
    try { target = assertOutboundUrl(endpoint(this.config), allowlist); }
    catch { throw new ModelConfigurationError('model endpoint violates outbound security policy'); }
    if (this.config.fetch === globalThis.fetch && !(await isAllowedOutboundUrlResolved(target.toString(), allowlist))) throw new ModelRequestError('model endpoint is not allowed');
    const timeout = setTimeout(() => controller.abort(), supplierRequestOptions(this.config.timeoutMs).timeoutMs);
    try {
      const response = await this.config.fetch(target.toString(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          store: false,
          reasoning: { effort: this.config.reasoningEffort },
          input: [
            {
              role: 'system',
              content: [{
                type: 'input_text',
                text: [
                  'You are the planning coordinator for a China domestic travel assistant.',
                  'Return only the requested structured planning object.',
                  `Use only these read and prepare planning tool names: ${modelToolNames(input)}.`,
                  'Never call save-candidate, proposal-acceptance, booking, redirect, payment, refund, traveler-profile, identity-document, candidate-write, or proposal-accept tools.',
                  input.conversationId
                    ? 'Return itinerary changes only in planProposal. Never mutate, accept, or reject a formal plan.'
                    : 'Every itinerary command must include the current tripId and expectedVersion; never invent a version or bypass the planning commands.',
                  'Never invent supplier prices, availability, locations, routes, bookings, or payments.',
                  'Ask only for fields that block read-only planning.',
                ].join(' '),
              }],
            },
            {
              role: 'user',
              content: [{
                type: 'input_text',
                text: JSON.stringify({
                  conversationId: input.conversationId,
                  tripId: input.tripId,
                  agentRunId: input.agentRunId,
                  userMessage: input.userMessage,
                  currentTripVersion: input.currentTripVersion,
                  planningContext: input.planningContext,
                  requestedRisk: input.requestedRisk ?? 'read',
                  redactedOffers: input.redactedOffers,
                  priorMessages: input.messages,
                  toolResults: input.toolResults,
                }),
              }],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'travel_planning_output',
              strict: true,
              schema: planningOutputJsonSchema(modelToolNames(input)),
            },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ModelRequestError(`model request failed with status ${response.status}`);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (controller.signal.aborted) throw new ModelRequestError('model request timed out');
        throw new ModelProtocolError();
      }
      const text = outputText(payload);
      if (!text) throw new ModelProtocolError();
      let structured: unknown;
      try {
        structured = JSON.parse(text);
      } catch {
        throw new ModelProtocolError();
      }
      const parsed = StructuredPlanningOutputSchema.safeParse(normalizeStrictOutput(structured));
      if (!parsed.success) throw new ModelProtocolError();
      assertPlanProposalBinding(parsed.data, input);
      return parsed.data;
    } catch (error) {
      if (error instanceof ModelRequestError || error instanceof ModelProtocolError) throw error;
      if (controller.signal.aborted) throw new ModelRequestError('model request timed out');
      throw new ModelRequestError('model request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertConfigured(): void {
    assertConfigured(this.config);
  }
}
