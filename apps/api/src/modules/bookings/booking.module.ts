import { Module } from '@nestjs/common';
import { ActionRequestService, BookingServiceImpl, DurableBookingAuditSink, GovernedBookingAuthorization, InMemoryBookingStore, RecordingBookingAuditSink, RecordingBookingOutboxSink, type BookingPolicyFacts, type TravelerDataGrantContext, type TravelerDataGrantRef, type TravelerDataGrantStore } from '@travel/application';
import { MockOrderService, RedirectTokenServiceImpl } from '@travel/supplier-adapters';
import type { ActionRequestInput, PolicySnapshot } from '@travel/contracts';
import { AuditRepository, BookingRepository, createDatabase } from '@travel/persistence';
import { travelMetrics } from '@travel/observability';
import { BookingController } from './booking.controller.js';
import { ACTION_REQUEST_SERVICE } from '../action-requests/action-request.tokens.js';
import { ActionRequestModule } from '../action-requests/action-request.module.js';
import { MANDATE_STORE } from '../mandates/mandate.tokens.js';
import { MandateModule } from '../mandates/mandate.module.js';
import { TravelerModule } from '../travelers/traveler.module.js';
import { TRAVELER_VAULT_REF_STORE } from '../travelers/traveler-vault-client.js';
import type { TravelerVaultRefStore } from '@travel/persistence';

export const BOOKING_GRANT_STORE = Symbol('BOOKING_GRANT_STORE');
export const BOOKING_AUDIT_SINK = Symbol('BOOKING_AUDIT_SINK');
export const BOOKING_OUTBOX_SINK = Symbol('BOOKING_OUTBOX_SINK');

/** Test-only grant boundary; production booking remains explicitly unavailable until a durable provider is configured. */
export class InMemoryBookingGrantStore implements TravelerDataGrantStore {
  private readonly records = new Map<string, { actorId: string; intentId: string; intentVersion: number; supplierLegalEntity: string; travelerIds: string[]; allowedFields: string[]; purpose: string; offerSnapshotHash: string; authorizationRef: string; expiresAt: string; usedAt?: string | null; revokedAt?: string | null }>();
  register(input: { id: string; actorId: string; intentId: string; intentVersion: number; supplierLegalEntity: string; travelerIds: string[]; allowedFields: string[]; purpose: string; offerSnapshotHash: string; authorizationRef: string; expiresAt: string }): void { this.records.set(input.id, { ...input, usedAt: null, revokedAt: null }); }
  async findById(id: string, actorId: string) { const record = this.records.get(id); return record && record.actorId === actorId ? { id, ownerId: actorId, ...structuredClone(record) } : null; }
  async consumeOnce(actorId: string, ref: TravelerDataGrantRef, context: TravelerDataGrantContext): Promise<void> {
    const record = this.records.get(ref.id);
    if (!record || record.actorId !== actorId || record.usedAt || record.revokedAt || record.intentId !== ref.intentId || record.expiresAt !== ref.expiresAt
      || record.intentId !== context.intentId || record.intentVersion !== context.intentVersion || record.supplierLegalEntity !== context.supplierLegalEntity
      || JSON.stringify(record.travelerIds) !== JSON.stringify(context.travelerIds) || JSON.stringify(record.allowedFields) !== JSON.stringify(context.allowedFields)
      || record.purpose !== context.purpose || record.offerSnapshotHash !== context.offerSnapshotHash || record.authorizationRef !== context.authorizationRef) throw new Error('grant is not authorized');
    record.usedAt = new Date().toISOString();
  }
}
class UnavailableDurableGrantStore implements TravelerDataGrantStore {
  async findById(): Promise<null> { return null; }
  async consumeOnce(): Promise<never> { throw new Error('durable traveler grant provider is unavailable'); }
}

class TestBookingFactsProvider {
  async snapshotFor(command: ActionRequestInput): Promise<BookingPolicyFacts | null> {
    const current: PolicySnapshot = {
      currentTripVersion: 1,
      currentBudget: {
        totalLimit: { amountCents: 100_000, currency: 'CNY' }, categoryLimits: {}, estimated: { amountCents: 0, currency: 'CNY' },
        reserved: { amountCents: 0, currency: 'CNY' }, committed: { amountCents: 0, currency: 'CNY' }, paid: { amountCents: 0, currency: 'CNY' }, released: { amountCents: 0, currency: 'CNY' }, categoryPaid: {},
      },
      currentOfferSnapshotHash: command.offerSnapshotHash ?? '', now: new Date().toISOString(),
    };
    return { ...current, itinerary: [] };
  }
}

@Module({
  imports: [ActionRequestModule, MandateModule, TravelerModule],
  controllers: [BookingController],
  providers: [
    { provide: BOOKING_GRANT_STORE, useFactory: () => process.env.DATABASE_URL ? new UnavailableDurableGrantStore() : new InMemoryBookingGrantStore() },
    { provide: BOOKING_AUDIT_SINK, useFactory: () => {
      if (!process.env.DATABASE_URL) {
        if (process.env.NODE_ENV === 'test') return new RecordingBookingAuditSink();
        throw new Error('durable audit storage is required for booking authorization');
      }
      return new DurableBookingAuditSink(new AuditRepository(createDatabase()));
    } },
    { provide: BOOKING_OUTBOX_SINK, useFactory: () => {
      if (!process.env.DATABASE_URL) {
        if (process.env.NODE_ENV === 'test') return new RecordingBookingOutboxSink();
        throw new Error('durable booking outbox is required for booking authorization');
      }
      const repository = new BookingRepository(createDatabase());
      return { append: async (entry: any, tx?: any) => { if (!tx) throw new Error('booking outbox append requires transaction'); await repository.appendOutboxEvent(tx, entry); }, appendInTransaction: async (entry: any, tx: any) => repository.appendOutboxEvent(tx, entry) };
    } },
    {
      provide: BookingServiceImpl,
      inject: [ACTION_REQUEST_SERVICE, MANDATE_STORE, BOOKING_GRANT_STORE, BOOKING_AUDIT_SINK, BOOKING_OUTBOX_SINK, TRAVELER_VAULT_REF_STORE],
      useFactory: (actions: ActionRequestService, mandates: { get(id: string, ownerId?: string): Promise<any> | any }, grants: TravelerDataGrantStore, audit: DurableBookingAuditSink | RecordingBookingAuditSink, outbox: any, travelerRefs: TravelerVaultRefStore) => {
        if (process.env.NODE_ENV !== 'test' && !process.env.DATABASE_URL) throw new Error('durable PostgreSQL booking repository and grant provider are required for booking execution');
        const store = process.env.DATABASE_URL ? new BookingRepository(createDatabase()) : new InMemoryBookingStore();
        const transaction = store instanceof BookingRepository ? <T>(callback: (tx?: unknown) => Promise<T>) => store.transaction(async tx => callback(tx)) : async <T>(callback: (tx?: unknown) => Promise<T>) => callback();
        const authorization = new GovernedBookingAuthorization(actions, mandates, new TestBookingFactsProvider(), grants, undefined, { audit, outbox, requireDurable: process.env.NODE_ENV !== 'test', policyStateIsAtomic: false, transaction, metrics: travelMetrics });
        return new BookingServiceImpl(store as any, new MockOrderService(), undefined, authorization, new RedirectTokenServiceImpl(process.env.REDIRECT_TOKEN_KEY ?? 'test-booking-key'), travelMetrics, travelerRefs);
      },
    },
  ],
  exports: [BookingServiceImpl, BOOKING_GRANT_STORE],
})
export class BookingModule {}
