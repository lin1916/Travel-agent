import { Money } from './money.js';
export type ActionRequestKind = 'booking_approval'|'traveler_data_authorization'|'revalidation'|'refund'|'cancel';
export interface ActionRequest { id: string; tripId: string; kind: ActionRequestKind; status: 'pending'|'approved'|'rejected'|'expired'; expiresAt: string; version: number }
export interface ActionRequestView extends ActionRequest { summary: string; reasons: string[]; amount?: Money }
export interface CancelRequest { bookingIntentId: string; reason?: string }
export interface RefundRequest { supplierOrderId: string; amount?: Money; reason?: string }
