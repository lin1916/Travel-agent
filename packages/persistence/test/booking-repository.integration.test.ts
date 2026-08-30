import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../src/db.js';
import { migrateToLatest } from '../src/migrations/runner.js';
import { BookingRepository, type SupplierOrderWrite } from '../src/repositories/booking-repository.js';
import { TripRepository } from '../src/repositories/trip-repository.js';
import { RepositoryConflictError } from '../src/types.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('PostgreSQL booking repository', () => {
  let db: ReturnType<typeof createDatabase>;
  let bookings: BookingRepository;
  let trips: TripRepository;

  beforeAll(async () => {
    db = createDatabase();
    await migrateToLatest(db);
    bookings = new BookingRepository(db);
    trips = new TripRepository(db);
  });

  afterAll(async () => {
    await closeDatabase(db);
  });

  it('enforces optimistic booking-intent CAS', async () => {
    const suffix = Date.now().toString();
    const tripId = `booking-cas-trip-${suffix}`;
    const intentId = `booking-cas-intent-${suffix}`;
    await trips.create({ id: tripId, ownerId: 'booking-owner', destination: '杭州', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-03T00:00:00.000Z', travelerCount: 1 });
    await bookings.create({ id: intentId, tripId, ownerId: 'booking-owner', offerId: 'offer-1', offerKind: 'train', status: 'draft', version: 1, payload: { selectedOfferSnapshotHash: 'offer-v1' } });

    await bookings.save({ id: intentId, tripId, ownerId: 'booking-owner', offerId: 'offer-1', offerKind: 'train', status: 'validating', version: 2, selectedOfferSnapshotHash: 'offer-v1' });
    await expect(bookings.save({ id: intentId, tripId, ownerId: 'booking-owner', offerId: 'offer-1', offerKind: 'train', status: 'submitting', version: 2, selectedOfferSnapshotHash: 'offer-v1' })).rejects.toBeInstanceOf(RepositoryConflictError);
  });

  it('distinguishes idempotency replay from a conflicting request', async () => {
    const actorId = `booking-idem-owner-${Date.now()}`;
    expect(await bookings.claimCommit(actorId, 'commit-1', { intentId: 'intent-1', expectedVersion: 1 })).toBe('claimed');
    expect(await bookings.claimCommit(actorId, 'commit-1', { expectedVersion: 1, intentId: 'intent-1' })).toBe('replay');
    expect(await bookings.claimCommit(actorId, 'commit-1', { intentId: 'intent-2', expectedVersion: 1 })).toBe('conflict');
  });

  it('abandons only the matching in-flight commit claim so consume failure can retry safely', async () => {
    const actorId = `booking-abandon-owner-${Date.now()}`;
    const request = { intentId: 'intent-1', expectedVersion: 1, actionRequestId: 'action-1' };
    expect(await bookings.claimCommit(actorId, 'commit-1', request)).toBe('claimed');
    expect(await bookings.abandonCommit(actorId, 'commit-1', { ...request, intentId: 'other-intent' })).toBe(false);
    expect(await bookings.claimCommit(actorId, 'commit-1', request)).toBe('replay');
    expect(await bookings.abandonCommit(actorId, 'commit-1', request)).toBe(true);
    expect(await bookings.claimCommit(actorId, 'commit-1', request)).toBe('claimed');
    await bookings.saveCommitResult(actorId, 'commit-1', { accepted: true });
    expect(await bookings.abandonCommit(actorId, 'commit-1', request)).toBe(false);
    expect(await bookings.getCommitResult(actorId, 'commit-1')).toEqual({ accepted: true });
  });

  it('persists intent, supplier order, outbox event, and response together', async () => {
    const suffix = Date.now().toString();
    const tripId = `booking-commit-trip-${suffix}`;
    const intentId = `booking-commit-intent-${suffix}`;
    const externalKey = `booking:${intentId}:commit-1`;
    await trips.create({ id: tripId, ownerId: 'booking-owner', destination: '上海', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-03T00:00:00.000Z', travelerCount: 1 });
    await bookings.create({ id: intentId, tripId, ownerId: 'booking-owner', offerId: 'offer-1', offerKind: 'train', status: 'submitting', version: 1, payload: { selectedOfferSnapshotHash: 'offer-v1' } });

    const order: SupplierOrderWrite = {
      id: `supplier-order-${suffix}`,
      intentId,
      ownerId: 'booking-owner',
      supplierId: 'mock-train',
      externalIdempotencyKey: externalKey,
      snapshot: { lifecycleStatus: 'awaiting_payment', reconciliationStatus: 'pending', supplierOrderRef: { supplierId: 'mock-train', supplierOrderId: `mock-${suffix}` }, paymentUrl: 'https://mock.example/pay' },
    };
    const result = { intent: { id: intentId, version: 2, status: 'awaiting_supplier' }, supplierOrder: order.snapshot };
    await bookings.claimCommit('booking-owner', 'commit-1', { intentId, expectedVersion: 1 });
    await bookings.persistCommit({ id: intentId, tripId, ownerId: 'booking-owner', offerId: 'offer-1', offerKind: 'train', status: 'awaiting_supplier', version: 2, selectedOfferSnapshotHash: 'offer-v1' }, order, result, 'booking-owner', 'commit-1');

    await expect(bookings.get(intentId)).resolves.toMatchObject({ status: 'awaiting_supplier', version: 2 });
    await expect(bookings.getSupplierOrder(order.id)).resolves.toMatchObject({ ownerId: 'booking-owner', snapshot: order.snapshot });
    await expect(bookings.getCommitResult('booking-owner', 'commit-1')).resolves.toEqual(result);
    await bookings.transaction(async tx => {
      await bookings.appendOutbox(tx, intentId, 'BookingAuthorizationConsumed', { intentVersion: 2 });
    });
    const events = await db.selectFrom('outbox_events').select(['sequence', 'event_type']).where('aggregate_type', '=', 'BookingIntent').where('aggregate_id', '=', intentId).execute();
    expect(events.map(event => event.sequence).sort()).toEqual([1, 2]);
    const history = await db.selectFrom('event_log').select(['sequence', 'event_type', 'trip_id']).where('aggregate_type', '=', 'BookingIntent').where('aggregate_id', '=', intentId).execute();
    expect(history.map(event => event.sequence).sort()).toEqual([1, 2]);
    expect(history.every(event => event.trip_id === tripId)).toBe(true);
  });

  it('persists reconciliation state with ordered event history and outbox atomically', async () => {
    const suffix = Date.now().toString();
    const tripId = `reconcile-trip-${suffix}`;
    const intentId = `reconcile-intent-${suffix}`;
    const orderId = `reconcile-order-${suffix}`;
    await trips.create({ id: tripId, ownerId: 'reconcile-owner', destination: '广州', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-03T00:00:00.000Z', travelerCount: 1 });
    await bookings.create({ id: intentId, tripId, ownerId: 'reconcile-owner', offerId: 'offer-1', offerKind: 'train', status: 'awaiting_supplier', version: 1, payload: {} });
    await bookings.saveSupplierOrder({ id: orderId, intentId, ownerId: 'reconcile-owner', supplierId: 'mock-rail', externalIdempotencyKey: `reconcile:${suffix}`, snapshot: { lifecycleStatus: 'payment_unknown', reconciliationStatus: 'pending', supplierOrderRef: { supplierId: 'mock-rail', supplierOrderId: orderId } } });

    await bookings.saveSupplierOrderReconciliation({ id: orderId, supplierId: 'mock-rail', lifecycleStatus: 'confirmed', reconciliationStatus: 'matched', paymentLocation: 'unknown', ticketOrReservationRef: 'reservation-1', refundRules: '', lastUpdatedAt: '2026-08-30T12:00:00.000Z' }, { event_id: `reconcile-event-${suffix}`, event_type: 'SupplierOrderReconciled', aggregate_type: 'SupplierOrder', aggregate_id: orderId, schema_version: 1, occurred_at: '2026-08-30T12:00:00.000Z', request_id: `reconcile:${orderId}`, correlation_id: `reconcile:${orderId}`, redacted_payload: { orderId, supplierId: 'mock-rail', lifecycleStatus: 'confirmed', reconciliationStatus: 'matched', source: 'poll' } });

    await expect(bookings.getSupplierOrderReconciliationView(orderId)).resolves.toMatchObject({ lifecycleStatus: 'confirmed', reconciliationStatus: 'matched', ticketOrReservationRef: 'reservation-1' });
    expect(await db.selectFrom('event_log').select('trip_id').where('event_id', '=', `reconcile-event-${suffix}`).executeTakeFirst()).toEqual({ trip_id: tripId });
    expect(await db.selectFrom('outbox_events').select('event_id').where('event_id', '=', `reconcile-event-${suffix}`).executeTakeFirst()).toEqual({ event_id: `reconcile-event-${suffix}` });
  });
});
