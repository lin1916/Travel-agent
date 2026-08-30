import { describe, expect, it } from 'vitest';
import type { EventEnvelope, SupplierOrderRef, SupplierOrderSnapshot } from '@travel/contracts';
import {
  ReconciliationServiceImpl,
  type ReconciliationOrderStore,
  type SupplierOrderView,
} from '../src/reconciliation/reconciliation-service.js';

class RecordingOrderStore implements ReconciliationOrderStore {
  readonly updates: SupplierOrderView[] = [];
  readonly events: EventEnvelope[] = [];
  constructor(public order: SupplierOrderView, private readonly ref: SupplierOrderRef) {}
  async get(orderId: string) { return orderId === this.order.id ? structuredClone(this.order) : null; }
  async getOrderRef(orderId: string) { return orderId === this.order.id ? this.ref : null; }
  async save(order: SupplierOrderView, event: Omit<EventEnvelope, 'sequence'>) {
    this.order = structuredClone(order);
    this.updates.push(structuredClone(order));
    this.events.push({ ...event, sequence: this.events.length + 1 });
  }
}

function order(overrides: Partial<SupplierOrderView> = {}): SupplierOrderView {
  return {
    id: 'order-1',
    lifecycleStatus: 'creation_unknown',
    reconciliationStatus: 'pending',
    supplierId: 'mock-train',
    paymentLocation: 'unknown',
    refundRules: 'refundable before departure',
    lastUpdatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

function serviceFor(store: RecordingOrderStore, snapshots: Array<SupplierOrderSnapshot | Error>) {
  let calls = 0;
  const adapter = {
    async getOrder() {
      const next = snapshots[Math.min(calls, snapshots.length - 1)]!;
      calls += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return {
    service: new ReconciliationServiceImpl(
      store,
      { get: supplierId => supplierId === 'mock-train' ? adapter : undefined },
      { maxAttempts: 3, now: () => new Date('2026-08-30T12:00:00.000Z'), id: () => `event-${store.events.length + 1}` },
    ),
    calls: () => calls,
  };
}

describe('supplier order reconciliation', () => {
  it('maps a compatible supplier snapshot to the matched lifecycle state', async () => {
    const store = new RecordingOrderStore(order(), { supplierId: 'mock-train', supplierOrderId: 'supplier-order-1' });
    const { service } = serviceFor(store, [{
      lifecycleStatus: 'confirmed', reconciliationStatus: 'matched', confirmationRef: 'reservation-ref-1',
      supplierOrderRef: { supplierId: 'mock-train', supplierOrderId: 'supplier-order-1' },
    }]);

    await expect(service.reconcile('order-1', 'poll')).resolves.toEqual({
      orderId: 'order-1', status: 'matched', lifecycleStatus: 'confirmed',
    });
    expect(store.order).toMatchObject({ lifecycleStatus: 'confirmed', reconciliationStatus: 'matched', ticketOrReservationRef: 'reservation-ref-1' });
    expect(store.events[0]).toMatchObject({ event_type: 'SupplierOrderReconciled', redacted_payload: { orderId: 'order-1', supplierId: 'mock-train', lifecycleStatus: 'confirmed', reconciliationStatus: 'matched', source: 'poll' } });
  });

  it('maps contradictory supplier state to discrepancy and manual review without false success', async () => {
    const store = new RecordingOrderStore(order({ lifecycleStatus: 'paid' }), { supplierId: 'mock-train', supplierOrderId: 'supplier-order-1' });
    const { service } = serviceFor(store, [{
      lifecycleStatus: 'cancelled', reconciliationStatus: 'matched',
      supplierOrderRef: { supplierId: 'mock-train', supplierOrderId: 'supplier-order-1' },
    }]);

    await expect(service.reconcile('order-1', 'webhook')).resolves.toEqual({
      orderId: 'order-1', status: 'discrepancy', lifecycleStatus: 'paid', reason: 'supplier lifecycle cancelled conflicts with paid',
    });
    expect(store.order).toMatchObject({ lifecycleStatus: 'paid', reconciliationStatus: 'discrepancy', requiredUserAction: 'manual_review' });
    expect(store.events[0]).toMatchObject({ event_type: 'ReconciliationRequired', redacted_payload: { orderId: 'order-1', supplierId: 'mock-train', lifecycleStatus: 'paid', reconciliationStatus: 'discrepancy', source: 'webhook' } });
    expect(JSON.stringify(store.events[0])).not.toContain('refundRules');
  });

  it('keeps an unknown snapshot in manual review after bounded attempts', async () => {
    const store = new RecordingOrderStore(order({ lifecycleStatus: 'payment_unknown' }), { supplierId: 'mock-train', supplierOrderId: 'supplier-order-1' });
    const { service, calls } = serviceFor(store, [{
      lifecycleStatus: 'payment_unknown', reconciliationStatus: 'pending',
      supplierOrderRef: { supplierId: 'mock-train', supplierOrderId: 'supplier-order-1' },
    }]);

    await expect(service.reconcile('order-1', 'manual')).resolves.toEqual({
      orderId: 'order-1', status: 'manual_review', lifecycleStatus: 'payment_unknown', reason: 'supplier state remained unknown after 3 attempts',
    });
    expect(calls()).toBe(3);
    expect(store.order).toMatchObject({ lifecycleStatus: 'payment_unknown', reconciliationStatus: 'manual_review', requiredUserAction: 'manual_review' });
    expect(store.events[0]?.event_type).toBe('ReconciliationRequired');
  });
});
