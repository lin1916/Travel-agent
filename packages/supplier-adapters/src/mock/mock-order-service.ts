import type { CreateOrderResponse, CreateSupplierOrder, RevalidatedOffer, RevalidateRequest, SupplierOrderSnapshot } from '@travel/contracts';

export interface MockOrderOptions { outcome: CreateOrderResponse['outcome']; snapshotHash: string; priceCents?: number; inventoryAvailable?: boolean; refundRulesHash?: string; startsAt?: string | null; endsAt?: string | null }

export class MockOrderService {
  readonly created = new Map<string, CreateSupplierOrder>();
  constructor(private readonly options: MockOrderOptions = { outcome: 'pending', snapshotHash: 'offer-v1' }) {}
  setSnapshotHash(snapshotHash: string): void { this.options.snapshotHash = snapshotHash; }
  setPriceCents(priceCents: number): void { this.options.priceCents = priceCents; }
  setInventoryAvailable(inventoryAvailable: boolean): void { this.options.inventoryAvailable = inventoryAvailable; }
  setOutcome(outcome: CreateOrderResponse['outcome']): void { this.options.outcome = outcome; }

  async revalidate(input: RevalidateRequest): Promise<RevalidatedOffer> {
    return {
      offerId: input.offerId,
      snapshotHash: this.options.snapshotHash,
      price: { amountCents: this.options.priceCents ?? 1000, currency: 'CNY' },
      inventoryAvailable: this.options.inventoryAvailable ?? true,
      refundRulesHash: this.options.refundRulesHash ?? 'rules-v1',
      startsAt: this.options.startsAt === null ? undefined : this.options.startsAt ?? '2026-09-10T08:00:00.000+08:00',
      endsAt: this.options.endsAt === null ? undefined : this.options.endsAt ?? '2026-09-10T10:00:00.000+08:00',
    };
  }

  async createOrder(input: CreateSupplierOrder): Promise<CreateOrderResponse> {
    this.created.set(input.externalIdempotencyKey, structuredClone(input));
    return this.options.outcome === 'accepted'
      ? { outcome: 'accepted', supplierOrderRef: 'mock-order-001', paymentUrl: 'https://mock.example/pay/mock-order-001' }
      : this.options.outcome === 'pending' ? { outcome: 'pending', supplierOrderRef: 'mock-order-001' } : { outcome: this.options.outcome };
  }

  toSnapshot(response: CreateOrderResponse): SupplierOrderSnapshot {
    if (response.outcome === 'indeterminate') return { lifecycleStatus: 'creation_unknown', reconciliationStatus: 'manual_review' };
    if (response.outcome === 'rejected') return { lifecycleStatus: 'failed', reconciliationStatus: 'not_required' };
    return { lifecycleStatus: 'awaiting_payment', reconciliationStatus: 'pending', supplierOrderRef: response.supplierOrderRef ? { supplierId: 'mock-train', supplierOrderId: response.supplierOrderRef } : undefined, paymentUrl: response.paymentUrl };
  }
}
