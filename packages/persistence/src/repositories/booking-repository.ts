import { randomUUID } from 'node:crypto';
import type { EventEnvelope, ReconciliationStatus, SupplierOrderLifecycle, SupplierOrderRef, SupplierOrderSnapshot } from '@travel/contracts';
import type { Kysely } from 'kysely';
import { withTransaction, type DatabaseTransaction } from '../db.js';
import { IdempotencyRepository, type IdempotencyClaim } from './idempotency-repository.js';
import { RepositoryConflictError, type BookingIntentsTable, type SupplierOrdersTable, type Database } from '../types.js';
import { EventRepository } from './event-repository.js';

export interface BookingIntentRecord {
  id: string;
  tripId: string;
  ownerId: string;
  offerId: string;
  offerKind: string;
  status: string;
  version: number;
  payload: Record<string, unknown>;
}

export interface SupplierOrderRecord {
  id: string;
  intentId: string;
  ownerId: string;
  supplierId: string;
  externalIdempotencyKey: string;
  lifecycleStatus: string;
  reconciliationStatus: string;
  snapshot: SupplierOrderSnapshot;
}

export interface SupplierOrderWrite {
  id: string;
  intentId: string;
  ownerId: string;
  supplierId: string;
  externalIdempotencyKey: string;
  snapshot: SupplierOrderSnapshot;
  lifecycleStatus?: string;
  reconciliationStatus?: string;
}

export interface SupplierOrderReconciliationView {
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

function intentFromRow(row: BookingIntentsTable): BookingIntentRecord {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  return { ...payload, id: row.id, tripId: row.trip_id, ownerId: row.owner_id, offerId: row.offer_id, offerKind: row.offer_kind, status: row.status, version: row.version, payload };
}

function orderFromRow(row: Pick<SupplierOrdersTable, 'id' | 'intent_id' | 'supplier_id' | 'external_idempotency_key' | 'lifecycle_status' | 'reconciliation_status' | 'payload_json'> & { owner_id?: string }): SupplierOrderRecord {
  const snapshot = JSON.parse(row.payload_json) as SupplierOrderSnapshot;
  return { id: row.id, intentId: row.intent_id, ownerId: String(row.owner_id ?? ''), supplierId: row.supplier_id, externalIdempotencyKey: row.external_idempotency_key, lifecycleStatus: row.lifecycle_status, reconciliationStatus: row.reconciliation_status, snapshot };
}

/** PostgreSQL source of truth for booking intents/orders. All writes use CAS or idempotency keys. */
export class BookingRepository {
  private readonly idempotency: IdempotencyRepository;
  constructor(private readonly db: Kysely<Database>) { this.idempotency = new IdempotencyRepository(db); }

  async create(intent: any, tx?: DatabaseTransaction): Promise<void> {
    const connection: any = tx ?? this.db;
    await connection.insertInto('booking_intents').values({ id: intent.id, trip_id: intent.tripId, owner_id: intent.ownerId, offer_id: intent.offerId, offer_kind: intent.offerKind, status: intent.status, version: intent.version, payload_json: JSON.stringify(intent.payload ?? intent), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).execute();
  }

  async get(id: string, tx?: DatabaseTransaction): Promise<BookingIntentRecord | null> {
    const row = await (tx ?? this.db as any).selectFrom('booking_intents').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? intentFromRow(row) : null;
  }

  async save(intent: any, tx?: DatabaseTransaction): Promise<void> {
    const result = await (tx ?? this.db as any).updateTable('booking_intents').set({ status: intent.status, version: intent.version, payload_json: JSON.stringify(intent.payload ?? intent), updated_at: new Date().toISOString() }).where('id', '=', intent.id).where('version', '=', intent.version - 1).where('owner_id', '=', intent.ownerId).executeTakeFirst();
    if (Number(result.numUpdatedRows ?? 0) !== 1) throw new RepositoryConflictError('booking intent version conflict');
  }

  async saveSupplierOrder(order: SupplierOrderRecord | SupplierOrderWrite, tx?: DatabaseTransaction): Promise<void> {
    const connection: any = tx ?? this.db;
    const now = new Date().toISOString();
    await connection.insertInto('supplier_orders').values({ id: order.id, intent_id: order.intentId, supplier_id: order.supplierId, lifecycle_status: order.lifecycleStatus ?? order.snapshot.lifecycleStatus, reconciliation_status: order.reconciliationStatus ?? order.snapshot.reconciliationStatus, payload_json: JSON.stringify(order.snapshot), external_idempotency_key: order.externalIdempotencyKey, payment_location: order.snapshot.paymentUrl ? 'supplier_page' : 'unknown', ticket_or_reservation_ref: order.snapshot.confirmationRef ?? null, refund_rules: '', required_user_action: null, last_updated_at: now, created_at: now }).onConflict((oc: any) => oc.column('external_idempotency_key').doNothing()).execute();
  }

  async getSupplierOrderReconciliationView(id: string): Promise<SupplierOrderReconciliationView | null> {
    const row = await this.db.selectFrom('supplier_orders').select(['id', 'supplier_id', 'lifecycle_status', 'reconciliation_status', 'payment_location', 'ticket_or_reservation_ref', 'refund_rules', 'required_user_action', 'last_updated_at']).where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      supplierId: row.supplier_id,
      lifecycleStatus: row.lifecycle_status as SupplierOrderLifecycle,
      reconciliationStatus: row.reconciliation_status as ReconciliationStatus,
      paymentLocation: row.payment_location === 'supplier_page' ? 'supplier_page' : 'unknown',
      ...(row.ticket_or_reservation_ref ? { ticketOrReservationRef: row.ticket_or_reservation_ref } : {}),
      refundRules: row.refund_rules,
      lastUpdatedAt: new Date(row.last_updated_at).toISOString(),
      ...(row.required_user_action ? { requiredUserAction: row.required_user_action } : {}),
    };
  }

  async getSupplierOrderRef(id: string): Promise<SupplierOrderRef | null> {
    const row = await this.db.selectFrom('supplier_orders').select(['supplier_id', 'payload_json']).where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    const snapshot = JSON.parse(row.payload_json) as SupplierOrderSnapshot;
    return snapshot.supplierOrderRef ?? null;
  }

  async saveSupplierOrderReconciliation(order: SupplierOrderReconciliationView, event: Omit<EventEnvelope, 'sequence'>): Promise<void> {
    await this.transaction(async tx => {
      const current = await tx.selectFrom('supplier_orders').innerJoin('booking_intents', 'booking_intents.id', 'supplier_orders.intent_id')
        .select(['supplier_orders.payload_json as payload_json', 'booking_intents.trip_id as trip_id'])
        .where('supplier_orders.id', '=', order.id).executeTakeFirst();
      if (!current) throw new Error(`supplier order not found: ${order.id}`);
      const snapshot = JSON.parse(current.payload_json) as SupplierOrderSnapshot;
      const updatedSnapshot: SupplierOrderSnapshot = {
        ...snapshot,
        lifecycleStatus: order.lifecycleStatus,
        reconciliationStatus: order.reconciliationStatus,
        ...(order.ticketOrReservationRef ? { confirmationRef: order.ticketOrReservationRef } : {}),
      };
      await tx.updateTable('supplier_orders').set({
        lifecycle_status: order.lifecycleStatus,
        reconciliation_status: order.reconciliationStatus,
        payload_json: JSON.stringify(updatedSnapshot),
        payment_location: order.paymentLocation,
        ticket_or_reservation_ref: order.ticketOrReservationRef ?? null,
        refund_rules: order.refundRules,
        required_user_action: order.requiredUserAction ?? null,
        last_updated_at: order.lastUpdatedAt,
      }).where('id', '=', order.id).executeTakeFirstOrThrow();
      await new EventRepository(this.db).appendAndPublishable(tx, { ...event, tripId: current.trip_id });
    });
  }

  async getSupplierOrder(id: string): Promise<SupplierOrderRecord | null> {
    const row: any = await (this.db as any).selectFrom('supplier_orders').innerJoin('booking_intents', 'booking_intents.id', 'supplier_orders.intent_id').select(['supplier_orders.id as id', 'supplier_orders.intent_id as intent_id', 'booking_intents.owner_id as owner_id', 'supplier_orders.supplier_id as supplier_id', 'supplier_orders.external_idempotency_key as external_idempotency_key', 'supplier_orders.lifecycle_status as lifecycle_status', 'supplier_orders.reconciliation_status as reconciliation_status', 'supplier_orders.payload_json as payload_json']).where('supplier_orders.id', '=', id).executeTakeFirst();
    return row ? orderFromRow(row) : null;
  }

  async listByTrip(tripId: string, actorId?: string): Promise<SupplierOrderReconciliationView[]> {
    let query = this.db.selectFrom('supplier_orders').innerJoin('booking_intents', 'booking_intents.id', 'supplier_orders.intent_id').select(['supplier_orders.id', 'supplier_orders.supplier_id', 'supplier_orders.lifecycle_status', 'supplier_orders.reconciliation_status', 'supplier_orders.payment_location', 'supplier_orders.ticket_or_reservation_ref', 'supplier_orders.refund_rules', 'supplier_orders.required_user_action', 'supplier_orders.last_updated_at']).where('booking_intents.trip_id', '=', tripId);
    if (actorId) query = query.where('booking_intents.owner_id', '=', actorId);
    const rows = await query.orderBy('supplier_orders.created_at', 'desc').execute();
    return rows.map(row => ({ id: row.id, supplierId: row.supplier_id, lifecycleStatus: row.lifecycle_status as SupplierOrderLifecycle, reconciliationStatus: row.reconciliation_status as ReconciliationStatus, paymentLocation: row.payment_location === 'supplier_page' ? 'supplier_page' : 'unknown', ...(row.ticket_or_reservation_ref ? { ticketOrReservationRef: row.ticket_or_reservation_ref } : {}), refundRules: row.refund_rules, lastUpdatedAt: new Date(row.last_updated_at).toISOString(), ...(row.required_user_action ? { requiredUserAction: row.required_user_action } : {}) }));
  }

  async getSupplierOrderForIntent(intentId: string): Promise<{ ownerId: string; supplierId: string; snapshot: SupplierOrderSnapshot } | null> {
    const row: any = await (this.db as any).selectFrom('supplier_orders').innerJoin('booking_intents', 'booking_intents.id', 'supplier_orders.intent_id').select(['booking_intents.owner_id as owner_id', 'supplier_orders.supplier_id as supplier_id', 'supplier_orders.payload_json as payload_json']).where('supplier_orders.intent_id', '=', intentId).orderBy('supplier_orders.created_at', 'desc').executeTakeFirst();
    return row ? { ownerId: String(row.owner_id), supplierId: String(row.supplier_id), snapshot: JSON.parse(row.payload_json) as SupplierOrderSnapshot } : null;
  }

  async claimCommit(actorId: string, idempotencyKey: string, request: unknown, tx?: DatabaseTransaction): Promise<IdempotencyClaim> { return this.idempotency.claim(`booking:commit:${actorId}`, idempotencyKey, request, tx); }
  async abandonCommit(actorId: string, idempotencyKey: string, request: unknown, tx?: DatabaseTransaction): Promise<boolean> { return this.idempotency.abandon(`booking:commit:${actorId}`, idempotencyKey, request, tx); }
  async getCommitResult<T>(actorId: string, idempotencyKey: string): Promise<T | null> { return this.idempotency.getResponse<T>(`booking:commit:${actorId}`, idempotencyKey); }
  async saveCommitResult(actorId: string, idempotencyKey: string, response: unknown, tx?: DatabaseTransaction): Promise<void> { await this.idempotency.complete(`booking:commit:${actorId}`, idempotencyKey, response, tx); }

  async persistCommit(intent: any, order: SupplierOrderRecord | SupplierOrderWrite, result: unknown, actorId: string, idempotencyKey: string): Promise<void> {
    await this.transaction(async tx => {
      await this.save(intent, tx);
      await this.saveSupplierOrder(order, tx);
      await this.appendOutbox(tx, intent.id, 'BookingIntentCommitted', { actorId, intentVersion: intent.version, supplierOrderId: order.id, lifecycleStatus: order.lifecycleStatus ?? order.snapshot.lifecycleStatus });
      await this.saveCommitResult(actorId, idempotencyKey, result, tx);
    });
  }

  async transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>): Promise<T> { return withTransaction(this.db, callback); }

  async appendOutbox(tx: DatabaseTransaction, aggregateId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    const aggregateType = 'BookingIntent';
    const intent = await tx.selectFrom('booking_intents').select('trip_id').where('id', '=', aggregateId).executeTakeFirstOrThrow();
    const occurredAt = new Date().toISOString();
    await new EventRepository(this.db).appendAndPublishable(tx, {
      event_id: randomUUID(),
      event_type: eventType,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      tripId: intent.trip_id,
      schema_version: 1,
      occurred_at: occurredAt,
      request_id: `booking:${aggregateId}`,
      correlation_id: `booking:${aggregateId}`,
      redacted_payload: payload,
    });
  }
}
