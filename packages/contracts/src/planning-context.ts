import { z } from 'zod';

const cstTimestamp = z.string().datetime({ offset: true }).refine(value => value.endsWith('+08:00'), 'planning context timestamps must use China Standard Time');

export const PlanningContextPatchSchema = z.object({
  destination: z.string().trim().min(1).max(120).optional(),
  origin: z.string().trim().min(1).max(120).optional(),
  startsAt: cstTimestamp.optional(),
  endsAt: cstTimestamp.optional(),
  travelerCount: z.number().int().min(1).max(6).optional(),
  totalBudgetCents: z.number().int().nonnegative().optional(),
  preferences: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  assumptions: z.array(z.enum(['traveler_count_defaulted_to_1'])).max(1).optional(),
}).strict();

export type PlanningContextPatch = z.infer<typeof PlanningContextPatchSchema>;
export type PlanningContextField = 'destination' | 'startsAt' | 'endsAt' | 'travelerCount';

export interface PlanningContext {
  conversationId: string;
  version: number;
  destination?: string;
  origin?: string;
  startsAt?: string;
  endsAt?: string;
  travelerCount?: number;
  totalBudgetCents?: number;
  preferences: string[];
  assumptions: Array<'traveler_count_defaulted_to_1'>;
  missingFields: PlanningContextField[];
  updatedAt: string;
}

export interface TripDraft {
  destination: string;
  startsAt: string;
  endsAt: string;
  travelerCount: number;
  totalBudgetCents: number;
}
