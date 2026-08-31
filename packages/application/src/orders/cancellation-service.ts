import type { ActionRequestView, CancelRequest, CancelResult, SupplierOrderRef } from '@travel/contracts';
import { ActionRequestService } from '../action-requests/action-request-service.js';
export interface CancellationAdapter { cancel(input: { orderRef: SupplierOrderRef; externalIdempotencyKey: string }): Promise<CancelResult> }
export class CancellationService {
  constructor(private readonly actions: ActionRequestService, private readonly adapter?: CancellationAdapter) {}
  requestCancel(input: CancelRequest, actorId = 'anonymous', tripId = input.orderId): Promise<ActionRequestView> { return this.actions.create(actorId, { tripId, resourceId: input.orderId, kind: 'cancel', risk: 'commit' }, { correlationId: `cancel:${input.orderId}`, reasons: [{ code: 'user_requested', message: input.reason }] as any }); }
  async executeCancel(input: CancelRequest, actorId: string, _tripId: string, supplierOrderRef: SupplierOrderRef, actionRequestId: string): Promise<CancelResult> { const action = await this.actions.getRecord(actionRequestId, actorId); if (action.kind !== 'cancel' || action.resourceId !== input.orderId || action.status !== 'approved') throw new Error('cancel action is not approved'); if (!this.adapter) throw new Error('cancellation adapter unavailable'); const result = await this.adapter.cancel({ orderRef: supplierOrderRef, externalIdempotencyKey: `cancel:${action.id}` }); if (result.outcome === 'indeterminate') throw new Error('cancellation result requires reconciliation'); await this.actions.consume(action.id, actorId, action.version); return result; }
}
