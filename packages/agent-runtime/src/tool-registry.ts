import { z } from 'zod';
import { ApplicationError, PlanService, type PlanContext, type SearchService } from '@travel/application';
import { PlanItemInputSchema, SearchRequestSchema, type PlanItemInput, type SearchRequest } from '@travel/contracts';
import type { CapabilityTool } from '@travel/capability-gateway';

const planReference = z.object({ tripId: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
export type PlanContextProvider = (tripId: string, ownerId: string) => Promise<PlanContext | undefined> | PlanContext | undefined;

function assertConversationProposalBoundary(conversationId?: string): void {
  if (conversationId) throw new ApplicationError('policy_blocked', 'Conversation planning changes must be returned as a plan proposal');
}

export function createPlanningTools(searchService: SearchService, planService = new PlanService(), planContextProvider?: PlanContextProvider): CapabilityTool<unknown, unknown>[] {
  const searchOffers: CapabilityTool<SearchRequest, unknown> = {
    name: 'search_offers',
    risk: 'read',
    inputSchema: SearchRequestSchema,
    execute: async (_context, input) => {
      const result = await searchService.search({ requests: [input], mode: 'value' });
      return { kind: input.kind, offers: result.offers[input.kind] ?? [], ranked: result.ranked[input.kind] ?? [], category: result.categories[input.kind] ?? {} };
    },
  };
  const addItem: CapabilityTool<{ tripId: string; expectedVersion: number; item: PlanItemInput }, unknown> = {
    name: 'add_itinerary_item', risk: 'prepare', inputSchema: planReference.extend({ item: PlanItemInputSchema }),
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.execute(input.tripId, context.actorId, { kind: 'add', item: PlanItemInputSchema.parse(input.item) }, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  const moveItem: CapabilityTool<{ tripId: string; expectedVersion: number; itemId: string; startsAt: string; endsAt: string; location?: { city: string; latitude?: number; longitude?: number } }, unknown> = {
    name: 'move_itinerary_item', risk: 'prepare', inputSchema: planReference.extend({ itemId: z.string().min(1), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), location: z.object({ city: z.string().min(1), latitude: z.number().finite().optional(), longitude: z.number().finite().optional() }).strict().optional() }),
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.execute(input.tripId, context.actorId, { kind: 'move', itemId: input.itemId, startsAt: input.startsAt, endsAt: input.endsAt, location: input.location }, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  const removeItem: CapabilityTool<{ tripId: string; expectedVersion: number; itemId: string }, unknown> = {
    name: 'remove_itinerary_item', risk: 'prepare', inputSchema: planReference.extend({ itemId: z.string().min(1) }),
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.execute(input.tripId, context.actorId, { kind: 'remove', itemId: input.itemId }, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  const replaceItem: CapabilityTool<{ tripId: string; expectedVersion: number; itemId: string; item: PlanItemInput }, unknown> = {
    name: 'replace_itinerary_item', risk: 'prepare', inputSchema: planReference.extend({ itemId: z.string().min(1), item: PlanItemInputSchema }),
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.execute(input.tripId, context.actorId, { kind: 'replace', itemId: input.itemId, item: PlanItemInputSchema.parse(input.item) }, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  const lockItem: CapabilityTool<{ tripId: string; expectedVersion: number; itemId: string; locked?: boolean }, unknown> = {
    name: 'lock_itinerary_item', risk: 'prepare', inputSchema: planReference.extend({ itemId: z.string().min(1), locked: z.boolean().default(true) }),
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.execute(input.tripId, context.actorId, { kind: 'lock', itemId: input.itemId, locked: input.locked ?? true }, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  const optimizeDay: CapabilityTool<{ tripId: string; expectedVersion: number; day: string }, unknown> = {
    name: 'optimize_day', risk: 'prepare', inputSchema: planReference.extend({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.execute(input.tripId, context.actorId, { kind: 'optimize', day: input.day }, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  const checkSchedule: CapabilityTool<{ tripId: string; expectedVersion: number }, unknown> = {
    name: 'check_schedule', risk: 'prepare', inputSchema: planReference,
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.execute(input.tripId, context.actorId, { kind: 'check' }, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  const calculateBudget: CapabilityTool<{ tripId: string; expectedVersion: number }, unknown> = {
    name: 'calculate_budget', risk: 'prepare', inputSchema: planReference,
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.execute(input.tripId, context.actorId, { kind: 'calculate' }, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  const undoPlan: CapabilityTool<{ tripId: string; expectedVersion: number }, unknown> = {
    name: 'undo_plan_change', risk: 'prepare', inputSchema: planReference,
    execute: async (context, input) => {
      assertConversationProposalBoundary(context.conversationId);
      return planService.undo(input.tripId, context.actorId, input.expectedVersion, await planContextProvider?.(input.tripId, context.actorId));
    },
  };
  return [searchOffers as CapabilityTool<unknown, unknown>, addItem as CapabilityTool<unknown, unknown>, moveItem as CapabilityTool<unknown, unknown>, removeItem as CapabilityTool<unknown, unknown>, replaceItem as CapabilityTool<unknown, unknown>, lockItem as CapabilityTool<unknown, unknown>, optimizeDay as CapabilityTool<unknown, unknown>, checkSchedule as CapabilityTool<unknown, unknown>, calculateBudget as CapabilityTool<unknown, unknown>, undoPlan as CapabilityTool<unknown, unknown>];
}
