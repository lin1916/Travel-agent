import { z } from 'zod';
import { Money, MoneySchema, RiskLevel, RiskLevelSchema } from './money.js';
import { PolicyReason, PolicyReasonSchema } from './mandate.js';
export const ActionRequestKindSchema = z.enum(['booking','traveler_data','cancel','refund','budget_override']);
export type ActionRequestKind = z.infer<typeof ActionRequestKindSchema>;
export const ActionRequestStatusSchema = z.enum(['pending','approved','rejected','expired','executed']);
export type ActionRequestStatus = z.infer<typeof ActionRequestStatusSchema>;
export interface ActionRequestInput { tripId: string; resourceId: string; kind: ActionRequestKind; risk: RiskLevel; requestedAmount?: Money; }
export interface ActionRequestView extends ActionRequestInput { id: string; status: ActionRequestStatus; reasons: PolicyReason[]; expiresAt: string; version: number }
export const ActionRequestInputSchema = z.object({ tripId: z.string().min(1), resourceId: z.string().min(1), kind: ActionRequestKindSchema, risk: RiskLevelSchema, requestedAmount: MoneySchema.optional() });
export const ActionRequestViewSchema = ActionRequestInputSchema.extend({ id: z.string().min(1), status: ActionRequestStatusSchema, reasons: z.array(PolicyReasonSchema), expiresAt: z.string(), version: z.number().int().nonnegative() });
export interface CancelRequest { orderId: string; reason: string; expectedVersion: number }
export interface RefundRequest { orderId: string; amount: Money; reason: string; expectedVersion: number }
export const CancelRequestSchema = z.object({ orderId: z.string().min(1), reason: z.string().min(1), expectedVersion: z.number().int().nonnegative() });
export const RefundRequestSchema = z.object({ orderId: z.string().min(1), amount: MoneySchema, reason: z.string().min(1), expectedVersion: z.number().int().nonnegative() });
