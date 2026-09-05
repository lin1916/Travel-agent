import { z } from 'zod';
import { MoneySchema, TravelCategorySchema, type Money, type TravelCategory } from './money.js';
import type { ItineraryWarning } from './trip.js';

const timestamp = z.string().datetime({ offset: true });

export const PlanItemInputSchema = z.object({
  category: TravelCategorySchema,
  title: z.string().trim().min(1).max(200),
  startsAt: timestamp,
  endsAt: timestamp,
  location: z.object({
    city: z.string().trim().min(1),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  }).strict().optional(),
  offerId: z.string().min(1).optional(),
  estimatedCostCents: z.number().int().nonnegative().default(0),
  priceScope: z.enum(['group', 'per_person']).default('group'),
}).strict();
export type PlanItemInput = z.input<typeof PlanItemInputSchema>;

export const PlanItemSchema = PlanItemInputSchema.extend({
  id: z.string().min(1),
  locked: z.boolean(),
}).strict();
export type PlanItem = z.infer<typeof PlanItemSchema>;

const locationPatch = z.object({
  city: z.string().trim().min(1),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
}).strict();

export const PlanCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), item: PlanItemInputSchema }).strict(),
  z.object({ kind: z.literal('move'), itemId: z.string().min(1), startsAt: timestamp, endsAt: timestamp, location: locationPatch.optional() }).strict(),
  z.object({ kind: z.literal('remove'), itemId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('replace'), itemId: z.string().min(1), item: PlanItemInputSchema }).strict(),
  z.object({ kind: z.literal('lock'), itemId: z.string().min(1), locked: z.boolean().default(true) }).strict(),
  z.object({ kind: z.literal('optimize'), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ kind: z.literal('check') }).strict(),
  z.object({ kind: z.literal('calculate') }).strict(),
]);
export type PlanCommand = z.infer<typeof PlanCommandSchema>;

export interface PlanningBudgetSummary {
  limit: Money;
  estimatedTotal: Money;
  groupTotal: Money;
  perPerson: Money;
  byCategory: Partial<Record<TravelCategory, Money>>;
  utilizationPercent: number;
  warnings: Array<'budget_80_percent' | 'budget_exceeded'>;
}

export interface PlanChangeSet {
  command: PlanCommand['kind'] | 'undo' | 'accept_proposal';
  summary: string;
  changedItemIds: string[];
}

export interface PlanVersion {
  id: string;
  tripId: string;
  version: number;
  createdAt: string;
  items: PlanItem[];
  warnings: ItineraryWarning[];
  budget: PlanningBudgetSummary;
  changeSet: PlanChangeSet;
}

export type TripPlan = PlanVersion;

export const PlanningBudgetSummarySchema = z.object({
  limit: MoneySchema,
  estimatedTotal: MoneySchema,
  groupTotal: MoneySchema,
  perPerson: MoneySchema,
  byCategory: z.record(MoneySchema),
  utilizationPercent: z.number().finite().nonnegative(),
  warnings: z.array(z.enum(['budget_80_percent', 'budget_exceeded'])),
}).strict();

export const PlanChangeSetSchema = z.object({
  command: z.enum(['add', 'move', 'remove', 'replace', 'lock', 'optimize', 'check', 'calculate', 'undo', 'accept_proposal']),
  summary: z.string().min(1),
  changedItemIds: z.array(z.string().min(1)),
}).strict();

export const PlanVersionSchema = z.object({
  id: z.string().min(1),
  tripId: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: timestamp,
  items: z.array(PlanItemSchema),
  warnings: z.array(z.object({ code: z.enum(['transfer_tight', 'airport_advance', 'rhythm']), message: z.string(), severity: z.enum(['info', 'warning']) }).strict()),
  budget: PlanningBudgetSummarySchema,
  changeSet: PlanChangeSetSchema,
}).strict();
