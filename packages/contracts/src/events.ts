import { z } from 'zod';
export interface EventEnvelope { event_id: string; event_type: string; aggregate_type: string; aggregate_id: string; run_id?: string; sequence: number; schema_version: number; occurred_at: string; request_id: string; correlation_id: string; redacted_payload: Record<string, unknown> }
export const EventEnvelopeSchema = z.object({ event_id: z.string(), event_type: z.string(), aggregate_type: z.string(), aggregate_id: z.string(), run_id: z.string().optional(), sequence: z.number().int().nonnegative(), schema_version: z.number().int().positive(), occurred_at: z.string(), request_id: z.string(), correlation_id: z.string(), redacted_payload: z.record(z.unknown()) });
export type TaskKind = 'search'|'booking'|'supplier_poll'|'reconciliation'|'outbox_dispatch'|'webhook_update';
export interface TaskOutcome { status: 'completed'|'retry'|'dead_letter'; retryAt?: string; reason?: string }
export interface AuditEntry { actorId: string; action: string; resource: string; policyResult: string; reason?: string; mandateVersion?: number; grantRef?: string; requestId: string; correlationId: string; occurredAt: string }
export interface AuditView extends AuditEntry { id: string; supplierId?: string; allowedFields?: string[] }
export interface LogEvent { name: string; requestId: string; correlationId: string; fields?: Record<string, unknown> }
