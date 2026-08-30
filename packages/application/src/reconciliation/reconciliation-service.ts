import { randomUUID } from 'node:crypto';
import type {
  EventEnvelope,
  ReconciliationStatus,
  SupplierOrderLifecycle,
  SupplierOrderRef,
  SupplierOrderSnapshot,
} from '@travel/contracts';
import type { BookingRepository } from '@travel/persistence';

export type ReconciliationSource = 'webhook' | 'poll' | 'manual';

export interface ReconciliationResult {
  orderId: string;
  status: ReconciliationStatus;
  lifecycleStatus: SupplierOrderLifecycle;
  reason?: string;
}

export interface SupplierOrderView {
  id: string;
  lifecycleStatus: SupplierOrderLifecycle;
  reconciliationStatus: ReconciliationStatus;
  supplierId: string;
  paymentLocation: 'supplier_page' | 'unknown';
  ticketOrReservationRef?: string;
  refundRules: string;
  lastUpdatedAt: string;
  requiredUserAction?: string;
}

export interface ReconciliationService {
  reconcile(orderId: string, source: ReconciliationSource): Promise<ReconciliationResult>;
}

export interface ReconciliationOrderStore {
  get(orderId: string): Promise<SupplierOrderView | null>;
  getOrderRef(orderId: string): Promise<SupplierOrderRef | null>;
  save(order: SupplierOrderView, event: Omit<EventEnvelope, 'sequence'>): Promise<void>;
}

export interface ReconciliationAdapterRegistry {
  get(supplierId: string): { getOrder(ref: SupplierOrderRef): Promise<SupplierOrderSnapshot> } | undefined;
}

export interface ReconciliationOptions {
  maxAttempts?: number;
  now?: () => Date;
  id?: () => string;
}

export class PersistentReconciliationOrderStore implements ReconciliationOrderStore {
  constructor(private readonly bookings: BookingRepository) {}
  get(orderId: string): Promise<SupplierOrderView | null> { return this.bookings.getSupplierOrderReconciliationView(orderId); }
  getOrderRef(orderId: string): Promise<SupplierOrderRef | null> { return this.bookings.getSupplierOrderRef(orderId); }
  save(order: SupplierOrderView, event: Omit<EventEnvelope, 'sequence'>): Promise<void> { return this.bookings.saveSupplierOrderReconciliation(order, event); }
}

const UNKNOWN_LIFECYCLES = new Set<SupplierOrderLifecycle>([
  'creating',
  'creation_unknown',
  'payment_processing',
  'payment_unknown',
  'cancelling',
  'cancellation_unknown',
]);

function compatible(current: SupplierOrderLifecycle, observed: SupplierOrderLifecycle): boolean {
  if (current === 'creation_unknown') return !UNKNOWN_LIFECYCLES.has(observed);
  if (current === 'payment_unknown') return ['awaiting_payment', 'paid', 'confirmed', 'failed', 'expired'].includes(observed);
  if (current === 'paid') return observed === 'confirmed';
  if (current === 'cancelling' || current === 'cancellation_unknown') return ['cancelled', 'refunding', 'refunded', 'failed'].includes(observed);
  return current === observed;
}

export class ReconciliationServiceImpl implements ReconciliationService {
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(
    private readonly orders: ReconciliationOrderStore,
    private readonly adapters: ReconciliationAdapterRegistry,
    options: ReconciliationOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
  }

  async reconcile(orderId: string, source: ReconciliationSource): Promise<ReconciliationResult> {
    const order = await this.orders.get(orderId);
    if (!order) throw new Error(`supplier order not found: ${orderId}`);
    const orderRef = await this.orders.getOrderRef(orderId);
    const adapter = this.adapters.get(order.supplierId);
    if (!orderRef || !adapter) {
      return this.manualReview(order, source, 'supplier order reference or adapter unavailable');
    }

    let lastSnapshot: SupplierOrderSnapshot | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        lastSnapshot = await adapter.getOrder(orderRef);
      } catch {
        continue;
      }
      if (UNKNOWN_LIFECYCLES.has(lastSnapshot.lifecycleStatus)
        || (order.lifecycleStatus === 'paid' && lastSnapshot.lifecycleStatus === 'paid')) {
        continue;
      }
      if (!compatible(order.lifecycleStatus, lastSnapshot.lifecycleStatus)) {
        const reason = `supplier lifecycle ${lastSnapshot.lifecycleStatus} conflicts with ${order.lifecycleStatus}`;
        return this.discrepancy(order, source, reason);
      }
      return this.matched(order, lastSnapshot, source);
    }

    const reason = lastSnapshot
      ? `supplier state remained unknown after ${this.maxAttempts} attempts`
      : `supplier could not be queried after ${this.maxAttempts} attempts`;
    return this.manualReview(order, source, reason);
  }

  private async matched(order: SupplierOrderView, snapshot: SupplierOrderSnapshot, source: ReconciliationSource): Promise<ReconciliationResult> {
    const updated: SupplierOrderView = {
      ...order,
      lifecycleStatus: snapshot.lifecycleStatus,
      reconciliationStatus: 'matched',
      ticketOrReservationRef: snapshot.confirmationRef ?? order.ticketOrReservationRef,
      lastUpdatedAt: this.now().toISOString(),
      requiredUserAction: undefined,
    };
    await this.persist(updated, source, 'SupplierOrderReconciled');
    return { orderId: order.id, status: 'matched', lifecycleStatus: updated.lifecycleStatus };
  }

  private async discrepancy(order: SupplierOrderView, source: ReconciliationSource, reason: string): Promise<ReconciliationResult> {
    const updated = { ...order, reconciliationStatus: 'discrepancy' as const, requiredUserAction: 'manual_review', lastUpdatedAt: this.now().toISOString() };
    await this.persist(updated, source, 'ReconciliationRequired', reason);
    return { orderId: order.id, status: 'discrepancy', lifecycleStatus: order.lifecycleStatus, reason };
  }

  private async manualReview(order: SupplierOrderView, source: ReconciliationSource, reason: string): Promise<ReconciliationResult> {
    const updated = { ...order, reconciliationStatus: 'manual_review' as const, requiredUserAction: 'manual_review', lastUpdatedAt: this.now().toISOString() };
    await this.persist(updated, source, 'ReconciliationRequired', reason);
    return { orderId: order.id, status: 'manual_review', lifecycleStatus: order.lifecycleStatus, reason };
  }

  private async persist(order: SupplierOrderView, source: ReconciliationSource, eventType: string, reason?: string): Promise<void> {
    const occurredAt = this.now().toISOString();
    const redactedPayload: Record<string, unknown> = {
      orderId: order.id,
      supplierId: order.supplierId,
      lifecycleStatus: order.lifecycleStatus,
      reconciliationStatus: order.reconciliationStatus,
      source,
    };
    if (reason) redactedPayload.reason = reason;
    await this.orders.save(order, {
      event_id: this.id(),
      event_type: eventType,
      aggregate_type: 'SupplierOrder',
      aggregate_id: order.id,
      schema_version: 1,
      occurred_at: occurredAt,
      request_id: `reconcile:${order.id}`,
      correlation_id: `reconcile:${order.id}`,
      redacted_payload: redactedPayload,
    });
  }
}
