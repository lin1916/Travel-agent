import type { ActionRequestView, RefundRequest, CancelResult, SupplierOrderRef } from '@travel/contracts';
import { ActionRequestService } from '../action-requests/action-request-service.js';
import type { CancellationAdapter } from './cancellation-service.js';
export class RefundService {
  constructor(private readonly actions: ActionRequestService, private readonly adapter?: CancellationAdapter) {}
  requestRefund(input: RefundRequest, actorId = 'anonymous', tripId = input.orderId): Promise<ActionRequestView> { return this.actions.create(actorId, { tripId, resourceId: input.orderId, kind: 'refund', risk: 'commit', requestedAmount: input.amount }, { correlationId: `refund:${input.orderId}`, reasons: [{ code: 'user_requested', message: input.reason }] as any }); }
  async executeRefund(input: RefundRequest, actorId: string, supplierOrderRef: SupplierOrderRef, actionRequestId: string): Promise<CancelResult> { const action = await this.actions.getRecord(actionRequestId, actorId); if (action.kind !== 'refund' || action.resourceId !== input.orderId || action.status !== 'approved') throw new Error('refund action is not approved'); if (!this.adapter) throw new Error('refund adapter unavailable'); const result = await this.adapter.cancel({ orderRef: supplierOrderRef, externalIdempotencyKey: `refund:${action.id}` }); if (result.outcome === 'indeterminate') throw new Error('refund result requires reconciliation'); await this.actions.consume(action.id, actorId, action.version); return result; }
}
