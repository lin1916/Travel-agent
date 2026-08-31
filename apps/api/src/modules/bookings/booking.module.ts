import { Module } from '@nestjs/common';
import { ActionRequestService, BookingServiceImpl, DurableBookingAuditSink, GovernedBookingAuthorization, InMemoryBookingStore, RecordingBookingAuditSink, type BookingPolicyFacts, type TravelerDataGrantContext, type TravelerDataGrantRef, type TravelerDataGrantStore } from '@travel/application';
import { MockOrderService, RedirectTokenServiceImpl } from '@travel/supplier-adapters';
import type { ActionRequestInput, PolicySnapshot } from '@travel/contracts';
import { AuditRepository, createDatabase } from '@travel/persistence';
import { travelMetrics } from '@travel/observability';
import { BookingController } from './booking.controller.js';
import { ACTION_REQUEST_SERVICE } from '../action-requests/action-request.tokens.js';
import { ActionRequestModule } from '../action-requests/action-request.module.js';
import { MANDATE_STORE } from '../mandates/mandate.tokens.js';
import { MandateModule } from '../mandates/mandate.module.js';

export const BOOKING_GRANT_STORE = Symbol('BOOKING_GRANT_STORE');
export const BOOKING_AUDIT_SINK = Symbol('BOOKING_AUDIT_SINK');

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
  imports: [ActionRequestModule, MandateModule],
  controllers: [BookingController],
  providers: [
    { provide: BOOKING_GRANT_STORE, useFactory: () => new InMemoryBookingGrantStore() },
    { provide: BOOKING_AUDIT_SINK, useFactory: () => {
      if (!process.env.DATABASE_URL) {
        if (process.env.NODE_ENV === 'test') return new RecordingBookingAuditSink();
        throw new Error('durable audit storage is required for booking authorization');
      }
      return new DurableBookingAuditSink(new AuditRepository(createDatabase()));
    } },
    {
      provide: BookingServiceImpl,
      inject: [ACTION_REQUEST_SERVICE, MANDATE_STORE, BOOKING_GRANT_STORE, BOOKING_AUDIT_SINK],
      useFactory: (actions: ActionRequestService, mandates: { get(id: string, ownerId?: string): Promise<any> | any }, grants: InMemoryBookingGrantStore, audit: DurableBookingAuditSink | RecordingBookingAuditSink) => {
        if (process.env.NODE_ENV !== 'test') throw new Error('durable PostgreSQL booking repository and grant provider are required for booking execution');
        const authorization = new GovernedBookingAuthorization(actions, mandates, new TestBookingFactsProvider(), grants, undefined, { audit, requireDurable: process.env.NODE_ENV !== 'test', transaction: async callback => callback(), metrics: travelMetrics });
        return new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService(), undefined, authorization, new RedirectTokenServiceImpl('test-booking-key'), travelMetrics);
      },
    },
  ],
  exports: [BookingServiceImpl, BOOKING_GRANT_STORE],
})
export class BookingModule {}
