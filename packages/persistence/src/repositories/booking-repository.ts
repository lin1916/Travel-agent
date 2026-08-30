import { randomUUID } from 'node:crypto';
import type { SupplierOrderSnapshot } from '@travel/contracts';
import { sql, type Kysely } from 'kysely';
import { withTransaction, type DatabaseTransaction } from '../db.js';
import { IdempotencyRepository, type IdempotencyClaim } from './idempotency-repository.js';
import { RepositoryConflictError, type BookingIntentsTable, type SupplierOrdersTable, type Database } from '../types.js';

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
    await connection.insertInto('supplier_orders').values({ id: order.id, intent_id: order.intentId, supplier_id: order.supplierId, lifecycle_status: order.lifecycleStatus ?? order.snapshot.lifecycleStatus, reconciliation_status: order.reconciliationStatus ?? order.snapshot.reconciliationStatus, payload_json: JSON.stringify(order.snapshot), external_idempotency_key: order.externalIdempotencyKey, created_at: new Date().toISOString() }).onConflict((oc: any) => oc.column('external_idempotency_key').doNothing()).execute();
  }

  async getSupplierOrder(id: string): Promise<SupplierOrderRecord | null> {
    const row: any = await (this.db as any).selectFrom('supplier_orders').innerJoin('booking_intents', 'booking_intents.id', 'supplier_orders.intent_id').select(['supplier_orders.id as id', 'supplier_orders.intent_id as intent_id', 'booking_intents.owner_id as owner_id', 'supplier_orders.supplier_id as supplier_id', 'supplier_orders.external_idempotency_key as external_idempotency_key', 'supplier_orders.lifecycle_status as lifecycle_status', 'supplier_orders.reconciliation_status as reconciliation_status', 'supplier_orders.payload_json as payload_json']).where('supplier_orders.id', '=', id).executeTakeFirst();
    return row ? orderFromRow(row) : null;
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
    await sql`select pg_advisory_xact_lock(hashtext(${`${aggregateType}:${aggregateId}`}))`.execute(tx);
    const current = await tx
      .selectFrom('outbox_events')
      .select(sql<number>`coalesce(max(sequence), 0)`.as('max_sequence'))
      .where('aggregate_type', '=', aggregateType)
      .where('aggregate_id', '=', aggregateId)
      .executeTakeFirst();
    const sequence = Number(current?.max_sequence ?? 0) + 1;
    await tx.insertInto('outbox_events').values({ event_id: randomUUID(), event_type: eventType, aggregate_type: aggregateType, aggregate_id: aggregateId, sequence, payload_json: JSON.stringify(payload), published_at: null, created_at: new Date().toISOString() }).execute();
  }
}
