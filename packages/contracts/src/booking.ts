import { z } from 'zod';
import { Money, OfferKind, OfferKindSchema } from './money.js';
export const CreateOrderResultSchema = z.enum(['accepted','pending','rejected','indeterminate']);
export type CreateOrderResult = z.infer<typeof CreateOrderResultSchema>;
export const BookingIntentStatusSchema = z.enum(['draft','awaiting_user_decision','validating','awaiting_traveler_data_grant','submitting','awaiting_supplier','completed','failed','expired','cancelling','cancelled']);
export type BookingIntentStatus = z.infer<typeof BookingIntentStatusSchema>;
export const SupplierOrderLifecycleSchema = z.enum(['creating','creation_unknown','awaiting_payment','payment_processing','payment_unknown','paid','confirmed','cancelling','cancelled','refunding','refunded','failed','expired']);
export type SupplierOrderLifecycle = z.infer<typeof SupplierOrderLifecycleSchema>;
export const ReconciliationStatusSchema = z.enum(['not_required','pending','matched','discrepancy','manual_review']);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;
export interface CreateOrderResponse { outcome: CreateOrderResult; supplierOrderRef?: string; paymentUrl?: string; redirectUrl?: string }
export interface SupplierOrderRef { supplierId: string; supplierOrderId: string }
export interface CreateSupplierOrder { intentId: string; offerSnapshotHash: string; travelerDataGrantId: string; executionAuthorizationRef: string; externalIdempotencyKey: string }
export interface SupplierOrderSnapshot { lifecycleStatus: SupplierOrderLifecycle; reconciliationStatus: ReconciliationStatus; supplierOrderRef?: SupplierOrderRef; paymentUrl?: string; confirmationRef?: string }
export interface SupplierWebhook { supplierId: string; rawBody: Uint8Array; headers: Record<string,string> }
export interface SupplierOrderUpdate { externalEventId: string; orderRef: SupplierOrderRef; lifecycleStatus: SupplierOrderLifecycle; paymentVerified: boolean }
export interface CancelSupplierOrder { orderRef: SupplierOrderRef; externalIdempotencyKey: string }
export interface CancelResult { outcome: 'accepted'|'completed'|'rejected'|'indeterminate'; refundAmount?: Money }
export interface BookingIntent { id: string; tripId: string; offerId: string; offerKind: OfferKind; status: BookingIntentStatus; version: number }
