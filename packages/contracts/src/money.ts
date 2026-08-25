import { z } from 'zod';

export const CurrencySchema = z.literal('CNY');
export type Currency = z.infer<typeof CurrencySchema>;
export const MoneySchema = z.object({ amountCents: z.number().int().nonnegative(), currency: CurrencySchema });
export type Money = z.infer<typeof MoneySchema>;

export const TravelCategorySchema = z.enum(['transport', 'stay', 'attraction', 'dining']);
export type TravelCategory = z.infer<typeof TravelCategorySchema>;
export const OfferKindSchema = z.enum(['train', 'flight', 'stay', 'attraction', 'dining']);
export type OfferKind = z.infer<typeof OfferKindSchema>;
export const RiskLevelSchema = z.enum(['read', 'prepare', 'commit', 'redirect']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export interface BudgetLedger { totalLimit: Money; categoryLimits: Partial<Record<TravelCategory, Money>>; estimated: Money; reserved: Money; committed: Money; paid: Money; released: Money; categoryPaid: Partial<Record<TravelCategory, Money>> }
export interface BudgetDelta { category: TravelCategory; amount: Money; ledgerState: 'estimated'|'reserved'|'committed'|'paid'|'released'; idempotencyKey: string }
export interface BudgetDecision { allowed: boolean; warning: boolean; blocked: boolean; totalAfter: Money; categoryAfter: Money; reasons: string[] }
