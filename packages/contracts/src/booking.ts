import { z } from 'zod';
import { Money, MoneySchema, OfferKind, OfferKindSchema } from './money.js';
export const CreateOrderResultSchema = z.enum(['accepted','pending','rejected','indeterminate']);
export type CreateOrderResult = z.infer<typeof CreateOrderResultSchema>;
export const BookingIntentStatusSchema = z.enum(['draft','awaiting_user_decision','validating','awaiting_traveler_data_grant','submitting','awaiting_supplier','completed','failed','expired','cancelling','cancelled']);
export type BookingIntentStatus = z.infer<typeof BookingIntentStatusSchema>;
export const SupplierOrderLifecycleSchema = z.enum(['creating','creation_unknown','awaiting_payment','payment_processing','payment_unknown','paid','confirmed','cancelling','cancelled','refunding','refunded','failed','expired']);
export type SupplierOrderLifecycle = z.infer<typeof SupplierOrderLifecycleSchema>;
export const ReconciliationStatusSchema = z.enum(['not_required','pending','matched','discrepancy','manual_review']);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;
export interface CreateOrderResponse { outcome: CreateOrderResult; supplierOrderRef?: string; paymentUrl?: string; redirectUrl?: string }
export const CreateOrderResponseSchema = z.object({
  outcome: CreateOrderResultSchema,
  supplierOrderRef: z.string().optional(),
  paymentUrl: z.string().url().optional(),
  redirectUrl: z.string().url().optional(),
});
export interface SupplierOrderRef { supplierId: string; supplierOrderId: string }
export const SupplierOrderRefSchema = z.object({ supplierId: z.string(), supplierOrderId: z.string() });
export interface CreateSupplierOrder { intentId: string; offerSnapshotHash: string; travelerDataGrantId: string; executionAuthorizationRef: string; externalIdempotencyKey: string }
export const CreateSupplierOrderSchema = z.object({ intentId: z.string(), offerSnapshotHash: z.string(), travelerDataGrantId: z.string(), executionAuthorizationRef: z.string(), externalIdempotencyKey: z.string() });
export interface SupplierOrderSnapshot { lifecycleStatus: SupplierOrderLifecycle; reconciliationStatus: ReconciliationStatus; supplierOrderRef?: SupplierOrderRef; paymentUrl?: string; confirmationRef?: string }
export const SupplierOrderSnapshotSchema = z.object({ lifecycleStatus: SupplierOrderLifecycleSchema, reconciliationStatus: ReconciliationStatusSchema, supplierOrderRef: z.object({ supplierId: z.string(), supplierOrderId: z.string() }).optional(), paymentUrl: z.string().url().optional(), confirmationRef: z.string().optional() });
export interface SupplierWebhook { supplierId: string; rawBody: Uint8Array; headers: Record<string,string> }
export const SupplierWebhookSchema = z.object({ supplierId: z.string(), rawBody: z.instanceof(Uint8Array), headers: z.record(z.string()) });
export interface SupplierOrderUpdate { externalEventId: string; orderRef: SupplierOrderRef; lifecycleStatus: SupplierOrderLifecycle; paymentVerified: boolean }
export const SupplierOrderUpdateSchema = z.object({
  externalEventId: z.string(),
  orderRef: SupplierOrderRefSchema,
  lifecycleStatus: SupplierOrderLifecycleSchema,
  paymentVerified: z.boolean(),
});
export interface CancelSupplierOrder { orderRef: SupplierOrderRef; externalIdempotencyKey: string }
export const CancelSupplierOrderSchema = z.object({
  orderRef: SupplierOrderRefSchema,
  externalIdempotencyKey: z.string(),
});
export interface CancelResult { outcome: 'accepted'|'completed'|'rejected'|'indeterminate'; refundAmount?: Money }
export const CancelResultSchema = z.object({
  outcome: z.enum(['accepted', 'completed', 'rejected', 'indeterminate']),
  refundAmount: MoneySchema.optional(),
});
export interface BookingIntent { id: string; tripId: string; offerId: string; offerKind: OfferKind; status: BookingIntentStatus; version: number }
export interface RevalidationResult { unchanged: boolean; currentOfferSnapshotHash: string; priceChanged: boolean; inventoryChanged: boolean; refundRulesChanged: boolean }
export interface RedirectContext { intentId: string; supplierId: string; nonce: string; issuedAt: string; expiresAt: string }
export interface RedirectTokenService { issue(input: RedirectContext, expiresAt: Date, actorId?: string): Promise<string>; verify(token: string, now: Date, expected?: { actorId?: string; supplierId?: string }): Promise<RedirectContext> }
