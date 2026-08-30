import { randomUUID } from 'node:crypto';
import type { ActionRequestView, BookingIntentStatus, RevalidationResult, SupplierOrderSnapshot } from '@travel/contracts';
import { createBookingIntent, transitionBookingIntent, type BookingIntentAggregate } from '@travel/domain';
import type { MockOrderService } from '@travel/supplier-adapters';
import { ApplicationError } from '../errors.js';

export interface CommitBookingIntent { intentId: string; expectedVersion: number; actionRequestId?: string; mandateId?: string; idempotencyKey: string; selectedOfferSnapshotHash: string }
export interface BookingIntentView { id: string; version: number; status: BookingIntentStatus; revalidation?: RevalidationResult }
export interface CommitBookingResult { intent: BookingIntentView; supplierOrder?: SupplierOrderSnapshot; redirectUrl?: string; requiresAction?: ActionRequestView }
export interface CreateBookingIntentInput { id: string; tripId: string; offerId: string; offerKind: any; supplierId: string; selectedOfferSnapshotHash: string; originalPriceCents: number; refundRulesHash: string; travelerDataGrantId: string }
export interface BookingIntentStore { create(intent: BookingIntentAggregate & { [key: string]: unknown }): Promise<void>; get(id: string): Promise<(BookingIntentAggregate & { [key: string]: unknown }) | null>; save(intent: BookingIntentAggregate & { [key: string]: unknown }): Promise<void> }

export class InMemoryBookingStore implements BookingIntentStore {
  private readonly records = new Map<string, BookingIntentAggregate & { [key: string]: unknown }>();
  async create(intent: BookingIntentAggregate & { [key: string]: unknown }) { if (this.records.has(intent.id)) throw new Error('booking intent already exists'); this.records.set(intent.id, structuredClone(intent)); }
  async get(id: string) { const value = this.records.get(id); return value ? structuredClone(value) : null; }
  async save(intent: BookingIntentAggregate & { [key: string]: unknown }) { if (!this.records.has(intent.id)) throw new Error('booking intent not found'); this.records.set(intent.id, structuredClone(intent)); }
}

export class BookingServiceImpl {
  private readonly consumedActions = new Set<string>();
  private readonly idempotency = new Map<string, CommitBookingResult>();
  constructor(private readonly store: BookingIntentStore, private readonly orders: MockOrderService, private readonly now: () => Date = () => new Date()) {}

  async create(_actorId: string, input: CreateBookingIntentInput): Promise<BookingIntentView> {
    const intent = createBookingIntent(input);
    await this.store.create({ ...intent, supplierId: input.supplierId, originalPriceCents: input.originalPriceCents, refundRulesHash: input.refundRulesHash, travelerDataGrantId: input.travelerDataGrantId });
    return this.view(intent);
  }

  async get(intentId: string, actorId: string): Promise<BookingIntentView> {
    const intent = await this.authorized(intentId, actorId);
    return this.view(intent);
  }

  async commit(actorId: string, input: CommitBookingIntent): Promise<CommitBookingResult> {
    const replay = this.idempotency.get(`${actorId}:${input.idempotencyKey}`);
    if (replay) return structuredClone(replay);
    const intent = await this.authorized(input.intentId, actorId);
    if (input.actionRequestId && this.consumedActions.has(input.actionRequestId)) throw new ApplicationError('conflict', 'action request already consumed');
    if (intent.version !== input.expectedVersion) throw new ApplicationError('conflict', 'booking intent version changed');
    if (intent.status !== 'draft') throw new ApplicationError('conflict', 'booking intent is already committed');
    const current = await this.orders.revalidate({ offerId: intent.offerId, supplierId: String(intent.supplierId), offerSnapshotHash: input.selectedOfferSnapshotHash });
    const revalidation: RevalidationResult = { unchanged: current.snapshotHash === input.selectedOfferSnapshotHash && current.inventoryAvailable && current.refundRulesHash === intent.refundRulesHash && current.price.amountCents === intent.originalPriceCents, currentOfferSnapshotHash: current.snapshotHash, priceChanged: current.price.amountCents !== intent.originalPriceCents, inventoryChanged: !current.inventoryAvailable, refundRulesChanged: current.refundRulesHash !== intent.refundRulesHash };
    intent.revalidation = revalidation;
    if (!revalidation.unchanged) {
      const paused = transitionBookingIntent(intent, 'awaiting_user_decision');
      await this.store.save(paused as BookingIntentAggregate & { [key: string]: unknown });
      const result = { intent: this.view(paused), requiresAction: { id: randomUUID(), status: 'pending', version: 1, kind: 'booking', risk: 'commit', resourceId: intent.offerId, tripId: intent.tripId, requestedAmount: { amountCents: current.price.amountCents, currency: 'CNY' }, reasons: [], expiresAt: new Date(this.now().getTime() + 300_000).toISOString() } as ActionRequestView };
      this.idempotency.set(`${actorId}:${input.idempotencyKey}`, result);
      return structuredClone(result);
    }
    if (input.actionRequestId) this.consumedActions.add(input.actionRequestId);
    let next = transitionBookingIntent(intent, 'awaiting_user_decision');
    next = transitionBookingIntent(next, 'validating');
    next = transitionBookingIntent(next, 'awaiting_traveler_data_grant');
    next = transitionBookingIntent(next, 'submitting');
    const response = await this.orders.createOrder({ intentId: intent.id, offerSnapshotHash: input.selectedOfferSnapshotHash, travelerDataGrantId: String(intent.travelerDataGrantId), executionAuthorizationRef: input.actionRequestId ?? input.mandateId ?? 'direct-decision', externalIdempotencyKey: `booking:${intent.id}:${input.idempotencyKey}` });
    const supplierOrder = this.orders.toSnapshot(response);
    next = transitionBookingIntent(next, 'awaiting_supplier');
    await this.store.save(next as BookingIntentAggregate & { [key: string]: unknown });
    const result = { intent: this.view(next), supplierOrder };
    this.idempotency.set(`${actorId}:${input.idempotencyKey}`, result);
    return structuredClone(result);
  }

  private async authorized(id: string, actorId: string): Promise<BookingIntentAggregate & Record<string, unknown>> {
    const intent = await this.store.get(id);
    if (!intent) throw new ApplicationError('validation_error', 'booking intent not found');
    if (intent.ownerId && intent.ownerId !== actorId) throw new ApplicationError('forbidden', 'booking intent belongs to another actor');
    if (!intent.ownerId) intent.ownerId = actorId;
    return intent;
  }
  private view(intent: BookingIntentAggregate): BookingIntentView { return { id: intent.id, version: intent.version, status: intent.status, revalidation: intent.revalidation }; }
}
