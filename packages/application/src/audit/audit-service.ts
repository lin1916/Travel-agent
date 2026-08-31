import type { AuditEntry, AuditView } from '@travel/contracts';
export type { AuditEntry, AuditView } from '@travel/contracts';
export interface AuditStore { append(entry: AuditEntry & { tripId?: string; supplierId?: string; allowedFields?: string[] }): Promise<void>; listForTrip(tripId: string, actorId: string): Promise<AuditView[]>; }
export interface AuditService { append(entry: AuditEntry & { tripId?: string; supplierId?: string; allowedFields?: string[] }): Promise<void>; listForTrip(tripId: string, actorId: string): Promise<AuditView[]>; }
export interface BookingAuthorizationAuditEvent {
  actorId: string;
  tripId: string;
  intentId: string;
  actionRequestId: string;
  mandateId: string;
  event: string;
  redactedPayload: Record<string, unknown>;
  requestId?: string;
  correlationId?: string;
}

export class DurableBookingAuditSink {
  constructor(
    private readonly writer: Pick<AuditStore, 'append'>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async append(event: BookingAuthorizationAuditEvent): Promise<void> {
    await this.writer.append({
      tripId: event.tripId,
      actorId: event.actorId,
      action: event.event,
      resource: event.intentId,
      policyResult: 'allow',
      reason: 'governed booking authorization consumed',
      mandateVersion: undefined,
      grantRef: event.actionRequestId,
      requestId: event.requestId ?? event.actionRequestId,
      correlationId: event.correlationId ?? event.requestId ?? event.actionRequestId,
      occurredAt: this.now(),
    });
  }
}

const ID = /^[A-Za-z0-9._:-]{1,256}$/;
export class AuditServiceImpl implements AuditService {
  constructor(private readonly store: AuditStore) {}
  async append(entry: AuditEntry & { tripId?: string; supplierId?: string; allowedFields?: string[] }): Promise<void> {
    if (!ID.test(entry.actorId) || !ID.test(entry.requestId) || !ID.test(entry.correlationId)) throw new Error('audit identifiers must be stable opaque references');
    if (!entry.action || !entry.resource || !entry.policyResult || !entry.occurredAt) throw new Error('audit entry is incomplete');
    await this.store.append(structuredClone(entry));
  }
  async listForTrip(tripId: string, actorId: string): Promise<AuditView[]> {
    if (!ID.test(tripId) || !ID.test(actorId)) throw new Error('audit identifiers must be stable opaque references');
    const rows = await this.store.listForTrip(tripId, actorId);
    return rows.map(row => ({ id: row.id, actorId: row.actorId, action: row.action, resource: row.resource, policyResult: row.policyResult, ...(row.reason ? { reason: row.reason } : {}), ...(row.mandateVersion !== undefined ? { mandateVersion: row.mandateVersion } : {}), ...(row.grantRef ? { grantRef: row.grantRef } : {}), requestId: row.requestId, correlationId: row.correlationId, occurredAt: row.occurredAt, ...(row.supplierId ? { supplierId: row.supplierId } : {}), ...(row.allowedFields ? { allowedFields: [...row.allowedFields] } : {}) }));
  }
}
