import { z } from 'zod';
import type { SearchService } from '@travel/application';
import { SearchRequestSchema, type SearchRequest } from '@travel/contracts';
import type { CapabilityTool } from '@travel/capability-gateway';

export function createPlanningTools(searchService: SearchService): CapabilityTool<unknown, unknown>[] {
  const searchOffers: CapabilityTool<SearchRequest, unknown> = {
    name: 'search_offers',
    risk: 'read',
    inputSchema: SearchRequestSchema,
    execute: async (_context, input) => {
      const result = await searchService.search({ requests: [input], mode: 'value' });
      return { kind: input.kind, offers: result.offers[input.kind] ?? [], ranked: result.ranked[input.kind] ?? [], category: result.categories[input.kind] ?? {} };
    },
  };
  const prepareItinerary: CapabilityTool<{ tripId: string; items: Array<{ kind: string; offerId?: string }> }, unknown> = {
    name: 'prepare_itinerary',
    risk: 'prepare',
    inputSchema: z.object({ tripId: z.string().min(1), items: z.array(z.object({ kind: z.string(), offerId: z.string().optional() })) }),
    execute: async (_context, input) => ({ status: 'draft', tripId: input.tripId, itemCount: input.items.length }),
  };
  return [searchOffers as CapabilityTool<unknown, unknown>, prepareItinerary as CapabilityTool<unknown, unknown>];
}
