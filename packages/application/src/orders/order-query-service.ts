import type { SupplierOrderLifecycle, ReconciliationStatus } from '@travel/contracts';
import type { BookingRepository } from '@travel/persistence';
export interface OrderProjection { id: string; supplierId: string; lifecycleStatus: SupplierOrderLifecycle; reconciliationStatus: ReconciliationStatus; paymentLocation: 'supplier_page' | 'unknown'; ticketOrReservationRef?: string; refundRules: string; lastUpdatedAt: string; requiredUserAction?: string }
export interface OrderQueryStore { listByTrip?(tripId: string, actorId: string): Promise<OrderProjection[]> }
export class OrderQueryService { constructor(private readonly store: OrderQueryStore | BookingRepository) {} async listByTrip(tripId: string, actorId: string): Promise<OrderProjection[]> { return this.store.listByTrip ? this.store.listByTrip(tripId, actorId) : []; } }
