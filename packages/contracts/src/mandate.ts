import { z } from 'zod';
import { Money, MoneySchema, OfferKind, OfferKindSchema } from './money.js';
export interface TravelMandate { id: string; tripId: string; version: number; totalBudgetLimit: Money; categoryLimits: Partial<Record<'transport'|'stay'|'attraction'|'dining', Money>>; allowedBookingTypes: OfferKind[]; allowedSuppliers: string[]; refundableOnly: boolean; maxSingleOrderAmount: Money; allowedSensitiveFields: string[]; validUntil: string; exceptionPolicy: string; revokedAt?: string }
export interface PolicyReason { code: string; message: string; blocking: boolean }
export const PolicyReasonSchema = z.object({ code: z.string().min(1), message: z.string().min(1), blocking: z.boolean() });
export const TravelMandateSchema = z.object({ id: z.string(), tripId: z.string(), version: z.number().int().nonnegative(), totalBudgetLimit: MoneySchema, categoryLimits: z.record(MoneySchema), allowedBookingTypes: z.array(OfferKindSchema), allowedSuppliers: z.array(z.string()), refundableOnly: z.boolean(), maxSingleOrderAmount: MoneySchema, allowedSensitiveFields: z.array(z.string()), validUntil: z.string(), exceptionPolicy: z.string(), revokedAt: z.string().optional() });
