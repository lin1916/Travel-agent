import { z } from 'zod';
import type { SearchService } from '@travel/application';
import type { SearchRequest } from '@travel/contracts';
import type { CapabilityTool } from '@travel/capability-gateway';

const SearchToolInputSchema = z.object({
  tripId: z.string().min(1), kind: z.enum(['train', 'flight', 'stay', 'attraction', 'dining']),
  origin: z.string().optional(), destination: z.string().min(1), startsAt: z.string(), endsAt: z.string().optional(),
  travelers: z.number().int().min(1).max(6), budgetLimit: z.object({ amountCents: z.number().int().nonnegative(), currency: z.literal('CNY') }).optional(),
});

export function createPlanningTools(searchService: SearchService): CapabilityTool<unknown, unknown>[] {
  const searchOffers: CapabilityTool<SearchRequest, unknown> = {
    name: 'search_offers',
    risk: 'read',
    inputSchema: SearchToolInputSchema,
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
