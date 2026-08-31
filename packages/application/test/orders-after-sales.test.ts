import { describe, expect, it } from 'vitest';
import { BudgetService } from '../src/budget/budget-service.js';
import { CancellationService } from '../src/orders/cancellation-service.js';
import { RefundService } from '../src/orders/refund-service.js';
import { ActionRequestService } from '../src/action-requests/action-request-service.js';
describe('orders and after-sales', () => {
  it('settles reserved money through committed and paid exactly once', () => {
    const budget = new BudgetService(); budget.initialize('trip-1', 10000); budget.reserve('trip-1', 'transport', 2500, 'reserve-1'); budget.settlePaid('trip-1', 'transport', 2500, 'settle-1'); budget.settlePaid('trip-1', 'transport', 2500, 'settle-1');
    expect(budget.get('trip-1')).toMatchObject({ reserved: { amountCents: 0 }, committed: { amountCents: 0 }, paid: { amountCents: 2500 } });
  });
  it('creates cancellation and refund decisions before execution', async () => {
    const actions = new ActionRequestService(); const cancellation = new CancellationService(actions); const refund = new RefundService(actions);
    const cancel = await cancellation.requestCancel({ orderId: 'order-1', reason: '行程变化', expectedVersion: 1 }, 'actor-1', 'trip-1');
    const refundRequest = await refund.requestRefund({ orderId: 'order-1', amount: { amountCents: 500, currency: 'CNY' }, reason: '部分退款', expectedVersion: 1 }, 'actor-1', 'trip-1');
    expect(cancel).toMatchObject({ kind: 'cancel', resourceId: 'order-1', status: 'pending' }); expect(refundRequest).toMatchObject({ kind: 'refund', resourceId: 'order-1', requestedAmount: { amountCents: 500 }, status: 'pending' });
  });
});
