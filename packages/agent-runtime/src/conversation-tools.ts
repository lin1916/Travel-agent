import { z } from 'zod';
import type { CapabilityTool } from '@travel/capability-gateway';
import {
  PlanningContextPatchSchema,
  type CandidatePlace,
  type Place,
  type PlanningContext,
  type PlanningContextPatch,
} from '@travel/contracts';

export interface PlanningContextToolPort {
  applyAndEnsureTrip(input: {
    sessionId: string;
    conversationId: string;
    currentTripId?: string;
    expectedContextVersion: number;
    patch: PlanningContextPatch;
  }): Promise<{ context: PlanningContext; trip?: { id: string; version: number; ownerId: string } }>;
}

export interface ConversationMapToolPort {
  searchPlaces(sessionId: string, conversationId: string, query: string): Promise<Place[]>;
}

export interface CandidateQueryPort {
  list(sessionId: string, conversationId: string): Promise<CandidatePlace[]>;
}

function requireConversation(conversationId: string | undefined): string {
  if (!conversationId) throw new Error('conversationId is required for this tool');
  return conversationId;
}

export function createConversationPlanningTools(
  planningContexts: PlanningContextToolPort,
  maps: ConversationMapToolPort,
  candidates: CandidateQueryPort,
): CapabilityTool<unknown, unknown>[] {
  const updatePlanningContext: CapabilityTool<{ expectedContextVersion: number; patch: PlanningContextPatch }, unknown> = {
    name: 'update_planning_context',
    risk: 'prepare',
    inputSchema: z.object({
      expectedContextVersion: z.number().int().positive(),
      patch: PlanningContextPatchSchema,
    }).strict(),
    execute: async (context, input) => planningContexts.applyAndEnsureTrip({
      sessionId: context.actorId,
      conversationId: requireConversation(context.conversationId),
      currentTripId: context.tripId,
      expectedContextVersion: input.expectedContextVersion,
      patch: input.patch,
    }),
  };
  const searchPlaces: CapabilityTool<{ query: string }, Place[]> = {
    name: 'search_places',
    risk: 'read',
    inputSchema: z.object({ query: z.string().trim().min(1).max(200) }).strict(),
    execute: async (context, input) => maps.searchPlaces(context.actorId, requireConversation(context.conversationId), input.query),
  };
  const listCandidatePlaces: CapabilityTool<Record<string, never>, CandidatePlace[]> = {
    name: 'list_candidate_places',
    risk: 'read',
    inputSchema: z.object({}).strict(),
    execute: async context => candidates.list(context.actorId, requireConversation(context.conversationId)),
  };
  return [
    updatePlanningContext as CapabilityTool<unknown, unknown>,
    searchPlaces as CapabilityTool<unknown, unknown>,
    listCandidatePlaces as CapabilityTool<unknown, unknown>,
  ];
}
