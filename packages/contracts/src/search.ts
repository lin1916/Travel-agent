import { z } from 'zod';
import { Money, MoneySchema, OfferKind, OfferKindSchema } from './money.js';

export interface SearchRequest { tripId: string; kind: OfferKind; origin?: string; destination: string; startsAt: string; endsAt?: string; travelers: number; budgetLimit?: Money }
const timezonedIso = z.string().refine(value => /(Z|[+-]\d{2}:\d{2})$/.test(value), 'timestamp must include an explicit timezone');
export const SearchRequestSchema = z.object({ tripId: z.string().min(1), kind: OfferKindSchema, origin: z.string().optional(), destination: z.string().min(1), startsAt: timezonedIso, endsAt: timezonedIso.optional(), travelers: z.number().int().min(1).max(6), budgetLimit: MoneySchema.optional() });
export interface RevalidateRequest { supplierId: string; offerSnapshotHash: string; offerId: string }
export interface RevalidatedOffer { offerId: string; snapshotHash: string; price: Money; inventoryAvailable: boolean; refundRulesHash: string }
export interface SupplierOffer { id: string; kind: OfferKind; supplierId: string; price: Money; snapshotHash: string; startsAt?: string; endsAt?: string; title?: string }
export const RevalidateRequestSchema = z.object({ supplierId: z.string(), offerSnapshotHash: z.string(), offerId: z.string() });
export const RevalidatedOfferSchema = z.object({ offerId: z.string(), snapshotHash: z.string(), price: MoneySchema, inventoryAvailable: z.boolean(), refundRulesHash: z.string() });
export const SupplierOfferSchema = z.object({ id: z.string(), kind: OfferKindSchema, supplierId: z.string(), price: MoneySchema, snapshotHash: z.string(), startsAt: z.string().optional(), endsAt: z.string().optional(), title: z.string().optional() });
export interface NormalizedOffer { id: string; kind: OfferKind; supplierId: string; title: string; price: Money; totalMinutes?: number; transferCount?: number; locationScore?: number; rating?: number; refundFlexibility?: number; refundSummary: string; source: string; updatedAt: string; snapshotHash: string }
export const NormalizedOfferSchema = z.object({ id: z.string(), kind: OfferKindSchema, supplierId: z.string(), title: z.string(), price: MoneySchema, totalMinutes: z.number().int().nonnegative().optional(), transferCount: z.number().int().nonnegative().optional(), locationScore: z.number().min(0).max(1).optional(), rating: z.number().min(0).max(5).optional(), refundFlexibility: z.number().min(0).max(1).optional(), refundSummary: z.string(), source: z.string(), updatedAt: z.string(), snapshotHash: z.string() });
export interface OfferPage { offers: NormalizedOffer[]; source: string; updatedAt: string; nextCursor?: string }
export const OfferPageSchema = z.object({ offers: z.array(NormalizedOfferSchema), source: z.string(), updatedAt: z.string(), nextCursor: z.string().optional() });
export interface RankedOffer extends NormalizedOffer { factorContributions: Record<string, number>; reasons: string[] }
export type RankingMode = 'value' | 'cheapest' | 'fastest' | 'comfortable';
