import { z } from 'zod';
import { Money, MoneySchema, TravelCategorySchema, TravelCategory } from './money.js';
export interface Versioned { id: string; version: number }
export interface ItineraryItem extends Versioned { tripId: string; category: TravelCategory; startsAt: string; endsAt: string; location?: { city: string; latitude?: number; longitude?: number }; offerId?: string; supplierOrderId?: string; confirmed: boolean }
export interface TripRecord extends Versioned { ownerId: string; destination: string; startsAt: string; endsAt: string; travelerCount: number }
export interface TimeConflict { candidateId: string; existingId: string; startsAt: string; endsAt: string }
export interface ItineraryWarning { code: 'transfer_tight'|'airport_advance'|'rhythm'; message: string; severity: 'info'|'warning' }
export interface RouteEstimator { estimate(from: string, to: string, at: string): Promise<{ minutes: number }> }
export const TripRecordSchema = z.object({ id: z.string(), version: z.number().int().nonnegative(), ownerId: z.string(), destination: z.string(), startsAt: z.string(), endsAt: z.string(), travelerCount: z.number().int().min(1).max(6) });
export const ItineraryItemSchema = z.object({ id: z.string(), version: z.number().int().nonnegative(), tripId: z.string(), category: TravelCategorySchema, startsAt: z.string(), endsAt: z.string(), location: z.object({ city: z.string(), latitude: z.number().optional(), longitude: z.number().optional() }).optional(), offerId: z.string().optional(), supplierOrderId: z.string().optional(), confirmed: z.boolean() });
export interface PolicySnapshot { currentTripVersion: number; currentBudget: BudgetLedger; currentOfferSnapshotHash: string; now: string }
export interface BudgetLedger { totalLimit: Money; categoryLimits: Partial<Record<TravelCategory, Money>>; estimated: Money; reserved: Money; committed: Money; paid: Money; released: Money; categoryPaid: Partial<Record<TravelCategory, Money>> }
const categoryMoney = z.record(MoneySchema);
export const BudgetLedgerSchema = z.object({ totalLimit: MoneySchema, categoryLimits: categoryMoney, estimated: MoneySchema, reserved: MoneySchema, committed: MoneySchema, paid: MoneySchema, released: MoneySchema, categoryPaid: categoryMoney });
export const PolicySnapshotSchema = z.object({ currentTripVersion: z.number().int().nonnegative(), currentBudget: BudgetLedgerSchema, currentOfferSnapshotHash: z.string(), now: z.string() });
