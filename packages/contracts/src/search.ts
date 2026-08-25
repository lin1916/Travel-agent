import { z } from 'zod';
import { Money, MoneySchema, OfferKind, OfferKindSchema } from './money.js';
export interface RevalidateRequest { supplierId: string; offerSnapshotHash: string; offerId: string }
export interface RevalidatedOffer { offerId: string; snapshotHash: string; price: Money; inventoryAvailable: boolean; refundRulesHash: string }
export interface SupplierOffer { id: string; kind: OfferKind; supplierId: string; price: Money; snapshotHash: string; startsAt?: string; endsAt?: string; title?: string }
export interface OfferPage { offers: SupplierOffer[]; nextCursor?: string }
export const RevalidateRequestSchema = z.object({ supplierId: z.string(), offerSnapshotHash: z.string(), offerId: z.string() });
export const RevalidatedOfferSchema = z.object({ offerId: z.string(), snapshotHash: z.string(), price: MoneySchema, inventoryAvailable: z.boolean(), refundRulesHash: z.string() });
export const SupplierOfferSchema = z.object({ id: z.string(), kind: OfferKindSchema, supplierId: z.string(), price: MoneySchema, snapshotHash: z.string(), startsAt: z.string().optional(), endsAt: z.string().optional(), title: z.string().optional() });
export const OfferPageSchema = z.object({ offers: z.array(SupplierOfferSchema), nextCursor: z.string().optional() });
