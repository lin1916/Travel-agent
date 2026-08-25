import { Money, OfferKind } from './money.js';
export interface TravelMandate { id: string; tripId: string; version: number; totalBudgetLimit: Money; categoryLimits: Partial<Record<'transport'|'stay'|'attraction'|'dining', Money>>; allowedBookingTypes: OfferKind[]; allowedSuppliers: string[]; refundableOnly: boolean; maxSingleOrderAmount: Money; allowedSensitiveFields: string[]; validUntil: string; exceptionPolicy: string; revokedAt?: string }
export interface PolicyReason { code: string; message: string; blocking: boolean }
