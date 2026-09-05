import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type { CapabilityContext, CapabilityGateway } from '@travel/capability-gateway';
import { SearchRequestSchema, type PlanningContext, type RiskLevel } from '@travel/contracts';
import { redactUserMessage } from './agent-run.js';

export interface PiTravelToolContext {
  actorId?: string;
  conversationId?: string;
  tripId?: string;
  agentRunId?: string;
  correlationId?: string;
  requestedRisk?: RiskLevel;
  actorAuthenticated?: boolean;
  tripOwnerId?: string;
  currentTripVersion?: number;
  expectedTripVersion?: number;
  planningContext?: PlanningContext;
}

const planningContextPatchSchema = Type.Object({
  destination: Type.Optional(Type.String({ minLength: 1 })),
  origin: Type.Optional(Type.String({ minLength: 1 })),
  startsAt: Type.Optional(Type.String({ minLength: 1, pattern: '\\+08:00$' })),
  endsAt: Type.Optional(Type.String({ minLength: 1, pattern: '\\+08:00$' })),
  travelerCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 6 })),
  totalBudgetCents: Type.Optional(Type.Integer({ minimum: 0 })),
  preferences: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  assumptions: Type.Optional(Type.Array(Type.Literal('traveler_count_defaulted_to_1'))),
});

const updatePlanningContextSchema = Type.Object({
  expectedContextVersion: Type.Integer({ minimum: 1 }),
  patch: planningContextPatchSchema,
});

const searchPlacesSchema = Type.Object({ query: Type.String({ minLength: 1 }) });
const listCandidatePlacesSchema = Type.Object({});

const searchOffersSchema = Type.Object({
  tripId: Type.Optional(Type.String({ minLength: 1 })),
  kind: Type.String({ minLength: 1 }),
  origin: Type.Optional(Type.String()),
  destination: Type.String({ minLength: 1 }),
  startsAt: Type.String({ minLength: 1 }),
  endsAt: Type.Optional(Type.String()),
  travelers: Type.Integer({ minimum: 1, maximum: 6 }),
  budgetLimit: Type.Optional(Type.Object({ amountCents: Type.Integer({ minimum: 0 }), currency: Type.String({ minLength: 1 }) })),
});

const planReferenceSchema = Type.Object({
  tripId: Type.String({ minLength: 1 }),
  expectedVersion: Type.Integer({ minimum: 1 }),
});
const planReferenceInputSchema = z.object({ tripId: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();

const sensitiveKey = /(authorization|cookie|api.?key|token|secret|password|passwd|credential|document|passport|payment|card|email|phone|traveler|identity|security.?code|supplier.?order)/i;

export function redactForModel(value: unknown, key = ''): unknown {
  if ((key === 'travelerCount' || key === 'travelers') && typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6) return value;
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return redactUserMessage(value)
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/((?:api[_ -]?key|token|secret|credential|document(?:number)?|passport|payment|security\s*code)\s*[:=]?\s*)[^\s,;]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(item => redactForModel(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entry]) => [entryKey, redactForModel(entry, entryKey)]));
  return value;
}

function resultFor(value: unknown): AgentToolResult<Record<string, unknown>> {
  const details = redactForModel(value);
  const safeDetails = details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : { value: details };
  return { content: [{ type: 'text', text: JSON.stringify(safeDetails) }], details: safeDetails };
}

function contextFor(toolCallId: string, input: { tripId?: string; expectedVersion?: number }, supplied: PiTravelToolContext | undefined, defaultRisk: RiskLevel = 'read'): CapabilityContext {
  return {
    actorId: supplied?.actorId ?? 'anonymous',
    conversationId: supplied?.conversationId,
    tripId: supplied?.tripId,
    agentRunId: supplied?.agentRunId ?? toolCallId,
    correlationId: supplied?.correlationId ?? toolCallId,
    requestedRisk: supplied?.requestedRisk ?? defaultRisk,
    actorAuthenticated: supplied?.actorAuthenticated ?? false,
    tripOwnerId: supplied?.tripOwnerId,
    currentTripVersion: supplied?.currentTripVersion,
    expectedTripVersion: supplied?.expectedTripVersion ?? input.expectedVersion,
  };
}

export function createPiTravelTools(gateway: CapabilityGateway, suppliedContext?: PiTravelToolContext): AgentTool[] {
  const updatePlanningContext: AgentTool<typeof updatePlanningContextSchema> = {
    name: 'update_planning_context', label: 'Update planning context', description: 'Apply validated Conversation planning fields and create a Trip when complete.', parameters: updatePlanningContextSchema, executionMode: 'sequential',
    execute: async (toolCallId, input) => {
      const result = await gateway.execute<Record<string, unknown>>('update_planning_context', contextFor(toolCallId, {}, suppliedContext, 'prepare'), input);
      const trip = result.trip;
      const planningContext = result.context;
      if (suppliedContext && trip && typeof trip === 'object') {
        const record = trip as { id?: unknown; version?: unknown; ownerId?: unknown };
        if (typeof record.id === 'string') suppliedContext.tripId = record.id;
        if (typeof record.version === 'number') {
          suppliedContext.currentTripVersion = record.version;
          suppliedContext.expectedTripVersion = record.version;
        }
        if (typeof record.ownerId === 'string') suppliedContext.tripOwnerId = record.ownerId;
      }
      if (suppliedContext && planningContext && typeof planningContext === 'object') suppliedContext.planningContext = planningContext as PlanningContext;
      return resultFor(result);
    },
  };
  const searchPlaces: AgentTool<typeof searchPlacesSchema> = {
    name: 'search_places', label: 'Search places', description: 'Search verified map places for the current Conversation.', parameters: searchPlacesSchema, executionMode: 'parallel',
    execute: async (toolCallId, input) => resultFor(await gateway.execute('search_places', contextFor(toolCallId, {}, suppliedContext), input)),
  };
  const listCandidatePlaces: AgentTool<typeof listCandidatePlacesSchema> = {
    name: 'list_candidate_places', label: 'List candidate places', description: 'List saved candidate places for the current Conversation.', parameters: listCandidatePlacesSchema, executionMode: 'parallel',
    execute: async (toolCallId, input) => resultFor(await gateway.execute('list_candidate_places', contextFor(toolCallId, {}, suppliedContext), input)),
  };
  const searchOffers: AgentTool<typeof searchOffersSchema> = {
    name: 'search_offers', label: 'Search offers', description: 'Search redacted travel offers.', parameters: searchOffersSchema, executionMode: 'parallel',
    execute: async (toolCallId, input) => {
      const parsed = SearchRequestSchema.parse({ ...input, tripId: input.tripId ?? suppliedContext?.tripId });
      return resultFor(await gateway.execute('search_offers', contextFor(toolCallId, parsed, suppliedContext), parsed));
    },
  };
  const checkSchedule: AgentTool<typeof planReferenceSchema> = {
    name: 'check_schedule', label: 'Check schedule', description: 'Check the current itinerary schedule.', parameters: planReferenceSchema, executionMode: 'sequential',
    execute: async (toolCallId, input) => {
      const parsed = planReferenceInputSchema.parse(input);
      return resultFor(await gateway.execute('check_schedule', contextFor(toolCallId, parsed, suppliedContext, 'prepare'), parsed));
    },
  };
  const calculateBudget: AgentTool<typeof planReferenceSchema> = {
    name: 'calculate_budget', label: 'Calculate budget', description: 'Calculate the current itinerary budget.', parameters: planReferenceSchema, executionMode: 'sequential',
    execute: async (toolCallId, input) => {
      const parsed = planReferenceInputSchema.parse(input);
      return resultFor(await gateway.execute('calculate_budget', contextFor(toolCallId, parsed, suppliedContext, 'prepare'), parsed));
    },
  };
  const conversationTools = [updatePlanningContext, searchPlaces, listCandidatePlaces, searchOffers];
  return suppliedContext?.conversationId ? conversationTools : [...conversationTools, checkSchedule, calculateBudget];
}
