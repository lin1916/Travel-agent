import type { Kysely } from 'kysely';
import { assertDurablePayloadSafe, canonicalRequestJson, TaskConflictError, type Database } from '../types.js';

export interface AcceptWebhookInput {
  supplierId: string;
  externalEventId: string;
  orderRef: { supplierId: string; supplierOrderId: string };
  payloadHash: string;
  taskId: string;
  taskPayload: Record<string, unknown>;
}

export class WebhookRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async resolveOrderId(orderRef: AcceptWebhookInput['orderRef'], connection: Kysely<Database> = this.db): Promise<string | null> {
    const rows = await connection.selectFrom('supplier_orders').select(['id', 'payload_json']).where('supplier_id', '=', orderRef.supplierId).execute();
    return rows.find(row => (JSON.parse(row.payload_json) as { supplierOrderRef?: { supplierOrderId?: string } }).supplierOrderRef?.supplierOrderId === orderRef.supplierOrderId)?.id ?? null;
  }

  async accept(input: AcceptWebhookInput): Promise<boolean> {
    assertDurablePayloadSafe(input.taskPayload, 'task.payload');
    return this.db.transaction().execute(async tx => {
      const localOrderId = await this.resolveOrderId(input.orderRef, tx);
      if (!localOrderId) throw new Error('supplier order is not locally mapped; manual review required');
      const receipt = await tx.insertInto('webhook_receipts').values({
        supplier_id: input.supplierId,
        external_event_id: input.externalEventId,
        order_id: localOrderId,
        payload_hash: input.payloadHash,
        task_id: input.taskId,
        received_at: new Date().toISOString(),
      }).onConflict(oc => oc.columns(['supplier_id', 'external_event_id']).doNothing()).returning('external_event_id').executeTakeFirst();
      if (!receipt) return false;

      const payloadJson = canonicalRequestJson({ ...input.taskPayload, orderId: localOrderId });
      const now = new Date().toISOString();
      await tx.insertInto('tasks').values({
        id: input.taskId,
        kind: 'webhook_update',
        status: 'pending',
        payload_json: payloadJson,
        attempts: 0,
        available_at: now,
        lease_owner: null,
        lease_until: null,
        last_error: null,
        created_at: now,
        updated_at: now,
      }).onConflict(oc => oc.column('id').doNothing()).execute();
      const task = await tx.selectFrom('tasks').select(['kind', 'payload_json']).where('id', '=', input.taskId).executeTakeFirst();
      if (!task || task.kind !== 'webhook_update' || task.payload_json !== payloadJson) throw new TaskConflictError(input.taskId);
      return true;
    });
  }
}
