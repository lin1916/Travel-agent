import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { AuditEntry, AuditView } from '@travel/contracts';
import type { Database } from '../types.js';

export function auditEntryId(entry: Pick<AuditEntry, 'actorId' | 'action' | 'resource' | 'requestId' | 'correlationId'>): string {
  return createHash('sha256')
    .update([entry.actorId, entry.action, entry.resource, entry.requestId, entry.correlationId].join('\u0000'))
    .digest('hex');
}

export class AuditRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async append(entry: AuditEntry & { tripId?: string; supplierId?: string; allowedFields?: string[] }): Promise<void> {
    await this.db.insertInto('audit_entries').values({ id: auditEntryId(entry), trip_id: entry.tripId ?? null, actor_id: entry.actorId, action: entry.action, resource: entry.resource, supplier_id: entry.supplierId ?? null, allowed_fields_json: entry.allowedFields ? JSON.stringify(entry.allowedFields) : null, policy_result: entry.policyResult, reason: entry.reason ?? null, mandate_version: entry.mandateVersion ?? null, grant_ref: entry.grantRef ?? null, request_id: entry.requestId, correlation_id: entry.correlationId, occurred_at: entry.occurredAt, created_at: new Date().toISOString() }).onConflict(oc => oc.column('id').doNothing()).execute();
  }
  async listForTrip(tripId: string, actorId: string): Promise<AuditView[]> {
    const rows = await this.db.selectFrom('audit_entries').selectAll().where('trip_id','=',tripId).where('actor_id','=',actorId).orderBy('occurred_at','desc').execute();
    return rows.map(row => ({ id:row.id, actorId:row.actor_id, action:row.action, resource:row.resource, policyResult:row.policy_result, ...(row.reason?{reason:row.reason}:{}), ...(row.mandate_version!==null?{mandateVersion:row.mandate_version}:{}), ...(row.grant_ref?{grantRef:row.grant_ref}:{}), requestId:row.request_id, correlationId:row.correlation_id, occurredAt:new Date(row.occurred_at).toISOString(), ...(row.supplier_id?{supplierId:row.supplier_id}:{}), ...(row.allowed_fields_json?{allowedFields:JSON.parse(row.allowed_fields_json) as string[]}: {}) }));
  }
}

