import { z } from 'zod';
import { PlaceSchema, type Place } from './map.js';

export const CandidateSourceSchema = z.enum(['user_search', 'accepted_agent_proposal']);
export type CandidateSource = z.infer<typeof CandidateSourceSchema>;

export const CandidatePlaceSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  place: PlaceSchema,
  source: CandidateSourceSchema,
  note: z.string().trim().min(1).max(2_000).optional(),
  priority: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export interface CandidatePlace {
  id: string;
  conversationId: string;
  place: Place;
  source: CandidateSource;
  note?: string;
  priority?: number;
  createdAt: string;
}
