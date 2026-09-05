import { z } from 'zod';
import type { CandidatePlace } from './candidate-place.js';
import { PlaceSchema, type Place } from './map.js';
import {
  PlanItemInputSchema,
  PlanningBudgetSummarySchema,
  type PlanItemInput,
  type PlanVersion,
  type PlanningBudgetSummary,
} from './plan.js';
import type { ItineraryWarning } from './trip.js';

const timestamp = z.string().datetime({ offset: true });
const cstTimestamp = timestamp.refine(value => value.endsWith('+08:00'), 'proposal timestamps must use China Standard Time');
const itineraryWarning = z.object({
  code: z.enum(['transfer_tight', 'airport_advance', 'rhythm']),
  message: z.string(),
  severity: z.enum(['info', 'warning']),
}).strict();

export const PlanProposalStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'expired']);
export type PlanProposalStatus = z.infer<typeof PlanProposalStatusSchema>;

export const ProposalPlanItemInputSchema = PlanItemInputSchema.extend({
  startsAt: cstTimestamp,
  endsAt: cstTimestamp,
}).strict();

export const PlanProposalDraftSchema = z.object({
  conversationId: z.string().min(1),
  tripId: z.string().min(1),
  planningContextVersion: z.number().int().positive(),
  proposedPlaces: z.array(PlaceSchema),
  itinerary: z.array(ProposalPlanItemInputSchema),
  budgetSummary: PlanningBudgetSummarySchema,
  warnings: z.array(itineraryWarning),
  reasoningSummary: z.string().trim().min(1).max(4_000).optional(),
  expiresAt: timestamp,
}).strict();

export interface PlanProposalDraft {
  conversationId: string;
  tripId: string;
  planningContextVersion: number;
  proposedPlaces: Place[];
  itinerary: PlanItemInput[];
  budgetSummary: PlanningBudgetSummary;
  warnings: ItineraryWarning[];
  reasoningSummary?: string;
  expiresAt: string;
}

export interface PlanProposal extends PlanProposalDraft {
  id: string;
  version: number;
  status: PlanProposalStatus;
  createdAt: string;
}

export const AcceptProposalPlaceInputSchema = z.object({
  placeId: z.string().min(1),
  expectedProposalVersion: z.number().int().positive(),
}).strict();
export type AcceptProposalPlaceInput = z.infer<typeof AcceptProposalPlaceInputSchema>;

export const AcceptProposalInputSchema = z.object({
  expectedProposalVersion: z.number().int().positive(),
  expectedPlanningContextVersion: z.number().int().positive(),
  expectedPlanVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();
export type AcceptProposalInput = z.infer<typeof AcceptProposalInputSchema>;

export interface ProposalAcceptanceResult {
  proposal: PlanProposal;
  planVersion: PlanVersion;
  candidates: CandidatePlace[];
}
