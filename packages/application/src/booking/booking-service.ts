import { randomUUID } from 'node:crypto';
import type { ActionRequestInput, ActionRequestView, BookingIntentStatus, ItineraryItem, Money, PolicySnapshot, RevalidationResult, SupplierOrderSnapshot, TravelMandate } from '@travel/contracts';
import { createBookingIntent, evaluateExecutionPolicy, findDirectOverlaps, transitionBookingIntent, type BookingIntentAggregate } from '@travel/domain';
import type { MockOrderService } from '@travel/supplier-adapters';
import type { RedirectTokenService } from '@travel/contracts';
import { ApplicationError } from '../errors.js';
import { ActionRequestService } from '../action-requests/action-request-service.js';

export interface CommitBookingIntent { intentId: string; expectedVersion: number; actionRequestId?: string; mandateId?: string; idempotencyKey: string; selectedOfferSnapshotHash: string }
export interface BookingIntentView { id: string; version: number; status: BookingIntentStatus; revalidation?: RevalidationResult }
export interface CommitBookingResult { intent: BookingIntentView; supplierOrder?: SupplierOrderSnapshot; redirectUrl?: string; requiresAction?: ActionRequestView }
export interface CreateBookingIntentInput { id: string; tripId: string; offerId: string; offerKind: any; supplierId: string; selectedOfferSnapshotHash: string; originalPriceCents: number; refundRulesHash: string; travelerDataGrantId: string; travelerDataGrantExpiresAt?: string; travelerIds?: string[]; requestedSensitiveFields?: string[]; travelerDataPurpose?: string; supplierLegalEntity?: string; refundable?: boolean; startsAt?: string; endsAt?: string }
export interface PersistedSupplierOrder { id: string; ownerId: string; intentId: string; supplierId: string; externalIdempotencyKey: string; snapshot: SupplierOrderSnapshot }
export interface BookingIntentStore { create(intent: BookingIntentAggregate & { [key: string]: unknown }): Promise<void>; get(id: string): Promise<(BookingIntentAggregate & { [key: string]: unknown }) | null>; save(intent: BookingIntentAggregate & { [key: string]: unknown }): Promise<void>; saveSupplierOrder?(order: PersistedSupplierOrder): Promise<void>; getSupplierOrder?(id: string): Promise<{ ownerId: string; snapshot: SupplierOrderSnapshot } | null>; getSupplierOrderForIntent?(intentId: string): Promise<{ ownerId: string; supplierId: string; snapshot: SupplierOrderSnapshot } | null>; claimCommit?(actorId: string, idempotencyKey: string, request: unknown): Promise<'claimed' | 'replay' | 'conflict'>; abandonCommit?(actorId: string, idempotencyKey: string, request: unknown): Promise<boolean>; getCommitResult?(actorId: string, idempotencyKey: string): Promise<CommitBookingResult | null>; saveCommitResult?(actorId: string, idempotencyKey: string, result: CommitBookingResult): Promise<void>; persistCommit?(intent: BookingIntentAggregate & { [key: string]: unknown }, order: PersistedSupplierOrder, result: CommitBookingResult, actorId: string, idempotencyKey: string): Promise<void> }
export interface AuthorizedBookingOffer { snapshotHash: string; price: Money; startsAt: string; endsAt: string }
export interface BookingAuthorization { authorize(actorId: string, intent: BookingIntentAggregate, input: CommitBookingIntent, offer: AuthorizedBookingOffer): Promise<{ consume(): Promise<void> }> }
export interface RedirectResolution { intentId: string; supplierId: string; redirectUrl: string }

export interface BookingPolicyFacts extends PolicySnapshot { itinerary?: ItineraryItem[] }
export interface BookingPolicyFactsProvider { snapshotFor(command: ActionRequestInput): Promise<BookingPolicyFacts | null> }
export interface TravelerDataGrantRef { id: string; intentId: string; expiresAt: string }
export interface TravelerDataGrantContext { intentId: string; intentVersion: number; supplierLegalEntity: string; travelerIds: string[]; allowedFields: string[]; purpose: string; offerSnapshotHash: string; authorizationRef: string }
export interface TravelerDataGrantStore { findById(id: string, actorId: string): Promise<{ id: string; ownerId?: string; intentId: string; intentVersion: number; supplierLegalEntity: string; travelerIds: string[]; allowedFields: string[]; purpose: string; offerSnapshotHash: string; authorizationRef: string; expiresAt: string; usedAt?: string | null; revokedAt?: string | null } | null>; consumeOnce(actorId: string, ref: TravelerDataGrantRef, context: TravelerDataGrantContext): Promise<unknown> }
export interface BookingAuditSink { append(entry: { actorId: string; tripId: string; intentId: string; actionRequestId: string; mandateId: string; event: string; redactedPayload: Record<string, unknown> }): Promise<void> }
export interface BookingOutboxSink { append(entry: { eventId: string; aggregateId: string; eventType: string; redactedPayload: Record<string, unknown> }): Promise<void> }
export interface BookingAuthorizationOptions { audit?: BookingAuditSink; outbox?: BookingOutboxSink; transaction?: <T>(callback: () => Promise<T>) => Promise<T> }

export class RecordingBookingAuditSink implements BookingAuditSink {
  readonly entries: Array<{ actorId: string; tripId: string; intentId: string; actionRequestId: string; mandateId: string; event: string; redactedPayload: Record<string, unknown> }> = [];
  async append(entry: { actorId: string; tripId: string; intentId: string; actionRequestId: string; mandateId: string; event: string; redactedPayload: Record<string, unknown> }): Promise<void> { this.entries.push(structuredClone(entry)); }
}
export class RecordingBookingOutboxSink implements BookingOutboxSink {
  readonly entries: Array<{ eventId: string; aggregateId: string; eventType: string; redactedPayload: Record<string, unknown> }> = [];
  async append(entry: { eventId: string; aggregateId: string; eventType: string; redactedPayload: Record<string, unknown> }): Promise<void> { this.entries.push(structuredClone(entry)); }
}

/** Resolves and evaluates the current ActionRequest + TravelMandate + facts, then consumes the exact grant and decision once. */
export class GovernedBookingAuthorization implements BookingAuthorization {
  private readonly audit: BookingAuditSink;
  private readonly outbox: BookingOutboxSink;
  private readonly transaction: <T>(callback: () => Promise<T>) => Promise<T>;
  constructor(
    private readonly actions: ActionRequestService,
    private readonly mandates: { get(id: string, ownerId?: string): Promise<TravelMandate | null> | TravelMandate | null },
    private readonly facts: BookingPolicyFactsProvider,
    private readonly grants: TravelerDataGrantStore,
    private readonly now: () => Date = () => new Date(),
    options: BookingAuthorizationOptions = {},
  ) {
    this.audit = options.audit ?? new RecordingBookingAuditSink();
    this.outbox = options.outbox ?? new RecordingBookingOutboxSink();
    this.transaction = options.transaction ?? (async callback => callback());
  }

  async authorize(actorId: string, intent: BookingIntentAggregate, input: CommitBookingIntent, offer: AuthorizedBookingOffer): Promise<{ consume(): Promise<void> }> {
    if (!input.actionRequestId || !input.mandateId) throw new Error('current ActionRequest and Mandate are required');
    const action = await this.actions.getRecord(input.actionRequestId, actorId);
    if (action.tripId !== intent.tripId || action.resourceId !== intent.offerId || action.kind !== 'booking' || action.risk !== 'commit'
      || action.supplierId !== intent.supplierId || action.bookingType !== intent.offerKind || action.offerSnapshotHash !== intent.selectedOfferSnapshotHash
      || (intent.refundable !== undefined && action.refundable !== intent.refundable)) throw new Error('action request does not bind this booking');
    if (action.status !== 'approved' || Date.parse(action.expiresAt) <= this.now().getTime()) throw new Error('action request is not currently approved');
    if (!action.requestedAmount || action.requestedAmount.amountCents !== offer.price.amountCents || action.requestedAmount.currency !== offer.price.currency) throw new Error('action request amount does not match the revalidated offer');
    const mandate = await this.mandates.get(input.mandateId, actorId);
    if (!mandate || mandate.tripId !== intent.tripId || mandate.revokedAt || Date.parse(mandate.validUntil) <= this.now().getTime()) throw new Error('mandate is not currently valid');
    const command: ActionRequestInput = { tripId: action.tripId, resourceId: action.resourceId, kind: action.kind, risk: action.risk, requestedAmount: structuredClone(offer.price), supplierId: action.supplierId, bookingType: action.bookingType, refundable: action.refundable, offerSnapshotHash: action.offerSnapshotHash, requestedSensitiveFields: action.requestedSensitiveFields };
    const current = await this.facts.snapshotFor(command);
    if (!current) throw new Error('current policy facts are unavailable');
    if (current.currentOfferSnapshotHash !== intent.selectedOfferSnapshotHash) throw new Error('offer changed since authorization');
    const candidate = { id: intent.id, version: intent.version, tripId: intent.tripId, category: intent.offerKind === 'train' || intent.offerKind === 'flight' ? 'transport' : intent.offerKind, startsAt: offer.startsAt, endsAt: offer.endsAt, confirmed: true } as ItineraryItem;
    if (findDirectOverlaps(current.itinerary ?? [], candidate).length > 0) throw new Error('booking overlaps a confirmed itinerary item');
    const decision = evaluateExecutionPolicy(command, mandate, current);
    if (!decision.allowed || decision.requiresFreshUserDecision) throw new Error(decision.reasons.map(item => item.code).join(',') || 'execution policy denied');
    const grantId = String(intent.travelerDataGrantId ?? '');
    const grant = await this.grants.findById(grantId, actorId);
    if (!grant || grant.intentId !== intent.id || grant.intentVersion !== intent.version || grant.offerSnapshotHash !== intent.selectedOfferSnapshotHash
      || grant.supplierLegalEntity !== String(intent.supplierLegalEntity ?? intent.supplierId) || grant.authorizationRef !== action.id
      || Date.parse(grant.expiresAt) <= this.now().getTime() || grant.usedAt || grant.revokedAt) throw new Error('traveler data grant is not bound to this booking');
    let consumed = false;
    return { consume: async () => {
      if (consumed) throw new Error('booking authorization already consumed');
      consumed = true;
      await this.transaction(async () => {
        await this.actions.consume(action.id, actorId, action.version, { kind: 'booking', resourceId: intent.offerId, requestHash: action.requestHash });
        await this.grants.consumeOnce(actorId, { id: grant.id, intentId: grant.intentId, expiresAt: grant.expiresAt }, { intentId: intent.id, intentVersion: intent.version, supplierLegalEntity: grant.supplierLegalEntity, travelerIds: grant.travelerIds, allowedFields: grant.allowedFields, purpose: grant.purpose, offerSnapshotHash: intent.selectedOfferSnapshotHash ?? '', authorizationRef: action.id });
        await this.audit.append({ actorId, tripId: intent.tripId, intentId: intent.id, actionRequestId: action.id, mandateId: mandate.id, event: 'BookingAuthorizationConsumed', redactedPayload: { intentVersion: intent.version, supplierId: intent.supplierId, offerId: intent.offerId } });
        await this.outbox.append({ eventId: randomUUID(), aggregateId: intent.id, eventType: 'BookingAuthorizationConsumed', redactedPayload: { actorId, actionRequestId: action.id, mandateId: mandate.id } });
      });
    } };
  }
}

/** Backwards-compatible alias for callers that now supply the full governed dependencies. */
export class ActionRequestBookingAuthorization extends GovernedBookingAuthorization {
  constructor(actions: ActionRequestService, mandates?: { get(id: string, ownerId?: string): Promise<TravelMandate | null> | TravelMandate | null }, facts?: BookingPolicyFactsProvider, grants?: TravelerDataGrantStore, now?: () => Date, options?: BookingAuthorizationOptions) {
    if (!mandates || !facts || !grants) throw new Error('mandate, current-facts, and traveler-grant providers are required');
    super(actions, mandates, facts, grants, now, options);
  }
}

export class InMemoryBookingStore implements BookingIntentStore {
  private readonly records = new Map<string, BookingIntentAggregate & { [key: string]: unknown }>();
  async create(intent: BookingIntentAggregate & { [key: string]: unknown }) { if (this.records.has(intent.id)) throw new Error('booking intent already exists'); this.records.set(intent.id, structuredClone(intent)); }
  async get(id: string) { const value = this.records.get(id); return value ? structuredClone(value) : null; }
  async save(intent: BookingIntentAggregate & { [key: string]: unknown }) { if (!this.records.has(intent.id)) throw new Error('booking intent not found'); this.records.set(intent.id, structuredClone(intent)); }
}

export class BookingServiceImpl {
  private readonly consumedActions = new Set<string>();
  private readonly idempotency = new Map<string, CommitBookingResult>();
  private readonly supplierOrders = new Map<string, { ownerId: string; intentId: string; supplierId: string; snapshot: SupplierOrderSnapshot }>();
  constructor(private readonly store: BookingIntentStore, private readonly orders: MockOrderService, private readonly now: () => Date = () => new Date(), private readonly authorization?: BookingAuthorization, private readonly redirects?: RedirectTokenService) {}

  async create(actorId: string, input: CreateBookingIntentInput): Promise<BookingIntentView> {
    if (!actorId || !input.tripId || !input.travelerDataGrantId) throw new ApplicationError('validation_error', 'actor, trip, and traveler data grant are required');
    const intent = createBookingIntent(input);
    await this.store.create({ ...intent, ownerId: actorId, supplierId: input.supplierId, originalPriceCents: input.originalPriceCents, refundRulesHash: input.refundRulesHash, travelerDataGrantId: input.travelerDataGrantId, travelerDataGrantExpiresAt: input.travelerDataGrantExpiresAt, travelerIds: input.travelerIds, requestedSensitiveFields: input.requestedSensitiveFields, travelerDataPurpose: input.travelerDataPurpose, supplierLegalEntity: input.supplierLegalEntity ?? input.supplierId, refundable: input.refundable });
    return this.view(intent);
  }

  async get(intentId: string, actorId: string): Promise<BookingIntentView> {
    const intent = await this.authorized(intentId, actorId);
    return this.view(intent);
  }

  async commit(actorId: string, input: CommitBookingIntent): Promise<CommitBookingResult> {
    const durableReplay = this.store.getCommitResult ? await this.store.getCommitResult(actorId, input.idempotencyKey) : null;
    const replay = durableReplay ?? this.idempotency.get(`${actorId}:${input.idempotencyKey}`);
    if (replay) return structuredClone(replay);
    const intent = await this.authorized(input.intentId, actorId);
    if (input.actionRequestId && this.consumedActions.has(input.actionRequestId)) throw new ApplicationError('conflict', 'action request already consumed');
    if (intent.version !== input.expectedVersion) throw new ApplicationError('conflict', 'booking intent version changed');
    if (intent.status !== 'draft' && intent.status !== 'awaiting_user_decision') throw new ApplicationError('conflict', 'booking intent is already committed');
    if (!input.actionRequestId && !input.mandateId) throw new ApplicationError('policy_blocked', 'authorization reference is required');
    if (!this.authorization) throw new ApplicationError('policy_blocked', 'authorization lookup is unavailable');
    if (input.selectedOfferSnapshotHash !== intent.selectedOfferSnapshotHash) throw new ApplicationError('conflict', 'offer snapshot changed');
    const current = await this.orders.revalidate({ offerId: intent.offerId, supplierId: String(intent.supplierId), offerSnapshotHash: String(intent.selectedOfferSnapshotHash) });
    const revalidation: RevalidationResult = { unchanged: current.snapshotHash === intent.selectedOfferSnapshotHash && current.inventoryAvailable && current.refundRulesHash === intent.refundRulesHash && current.price.amountCents === intent.originalPriceCents, currentOfferSnapshotHash: current.snapshotHash, priceChanged: current.price.amountCents !== intent.originalPriceCents, inventoryChanged: !current.inventoryAvailable, refundRulesChanged: current.refundRulesHash !== intent.refundRulesHash };
    intent.revalidation = revalidation;
    if (!revalidation.unchanged) {
      const paused = transitionBookingIntent(intent, 'awaiting_user_decision');
      await this.store.save(paused as BookingIntentAggregate & { [key: string]: unknown });
      const result = { intent: this.view(paused), requiresAction: { id: randomUUID(), status: 'pending', version: 1, kind: 'booking', risk: 'commit', resourceId: intent.offerId, tripId: intent.tripId, requestedAmount: { amountCents: current.price.amountCents, currency: 'CNY' }, reasons: [], expiresAt: new Date(this.now().getTime() + 300_000).toISOString() } as ActionRequestView };
      this.idempotency.set(`${actorId}:${input.idempotencyKey}`, result);
      return structuredClone(result);
    }
    if (!Number.isInteger(current.price.amountCents) || current.price.amountCents < 0 || current.price.currency !== 'CNY') throw new ApplicationError('policy_blocked', 'offer price is unavailable');
    if (!current.startsAt || !current.endsAt || !Number.isFinite(Date.parse(current.startsAt)) || !Number.isFinite(Date.parse(current.endsAt)) || Date.parse(current.startsAt) >= Date.parse(current.endsAt)) throw new ApplicationError('policy_blocked', 'offer schedule is unavailable');
    const offer: AuthorizedBookingOffer = { snapshotHash: current.snapshotHash, price: structuredClone(current.price), startsAt: current.startsAt, endsAt: current.endsAt };
    intent.offerAmount = structuredClone(offer.price);
    intent.startsAt = offer.startsAt;
    intent.endsAt = offer.endsAt;
    let authorization: { consume(): Promise<void> };
    try { authorization = await this.authorization.authorize(actorId, intent, input, offer); } catch (error) { throw new ApplicationError('policy_blocked', error instanceof Error ? error.message : 'authorization denied'); }
    const requestForHash = { intentId: input.intentId, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey, selectedOfferSnapshotHash: input.selectedOfferSnapshotHash, ...(input.actionRequestId ? { actionRequestId: input.actionRequestId } : {}), ...(input.mandateId ? { mandateId: input.mandateId } : {}) };
    if (this.store.claimCommit) {
      if (!this.store.abandonCommit) throw new ApplicationError('policy_blocked', 'durable idempotency recovery is unavailable');
      const claim = await this.store.claimCommit(actorId, input.idempotencyKey, requestForHash);
      if (claim === 'conflict') throw new ApplicationError('conflict', 'idempotency key was reused with a different request');
      if (claim === 'replay') {
        const existing = this.store.getCommitResult ? await this.store.getCommitResult(actorId, input.idempotencyKey) : null;
        if (existing) return structuredClone(existing);
        throw new ApplicationError('conflict', 'idempotent request is still recovering');
      }
    }
    try {
      await authorization.consume();
    } catch (error) {
      if (this.store.claimCommit) {
        const abandoned = await this.store.abandonCommit!(actorId, input.idempotencyKey, requestForHash);
        if (!abandoned) throw new ApplicationError('conflict', 'failed authorization left an indeterminate idempotency claim');
      }
      throw error;
    }
    if (input.actionRequestId) this.consumedActions.add(input.actionRequestId);
    let next = intent.status === 'draft' ? transitionBookingIntent(intent, 'awaiting_user_decision') : structuredClone(intent);
    if (this.store.persistCommit) await this.store.save(next as BookingIntentAggregate & { [key: string]: unknown });
    next = transitionBookingIntent(next, 'validating');
    if (this.store.persistCommit) await this.store.save(next as BookingIntentAggregate & { [key: string]: unknown });
    next = transitionBookingIntent(next, 'awaiting_traveler_data_grant');
    if (this.store.persistCommit) await this.store.save(next as BookingIntentAggregate & { [key: string]: unknown });
    next = transitionBookingIntent(next, 'submitting');
    if (this.store.persistCommit) await this.store.save(next as BookingIntentAggregate & { [key: string]: unknown });
    const response = await this.orders.createOrder({ intentId: intent.id, offerSnapshotHash: String(intent.selectedOfferSnapshotHash), amount: structuredClone(offer.price), travelerDataGrantId: String(intent.travelerDataGrantId), executionAuthorizationRef: input.actionRequestId ?? input.mandateId as string, externalIdempotencyKey: `booking:${intent.id}:${input.idempotencyKey}` });
    const supplierOrder = this.orders.toSnapshot(response);
    const orderId = supplierOrder.supplierOrderRef?.supplierOrderId ?? `unknown-${intent.id}`;
    const persistedOrder = { id: orderId, ownerId: actorId, intentId: intent.id, supplierId: String(intent.supplierId), externalIdempotencyKey: `booking:${intent.id}:${input.idempotencyKey}`, snapshot: structuredClone(supplierOrder) };
    if (!this.store.persistCommit && this.store.saveSupplierOrder) await this.store.saveSupplierOrder(persistedOrder);
    else if (!this.store.persistCommit) this.supplierOrders.set(orderId, { ownerId: actorId, intentId: intent.id, supplierId: String(intent.supplierId), snapshot: structuredClone(supplierOrder) });
    next = response.outcome === 'rejected' ? transitionBookingIntent(next, 'failed') : transitionBookingIntent(next, 'awaiting_supplier');
    const result: CommitBookingResult = { intent: this.view(next), supplierOrder };
    if (this.redirects && supplierOrder.paymentUrl) {
      const expiresAt = new Date(this.now().getTime() + 5 * 60_000);
      const token = await this.redirects.issue({ intentId: intent.id, supplierId: String(intent.supplierId), nonce: randomUUID(), issuedAt: this.now().toISOString(), expiresAt: expiresAt.toISOString() }, expiresAt, actorId);
      result.redirectUrl = `/v1/supplier-redirects/${encodeURIComponent(String(intent.supplierId))}?token=${encodeURIComponent(token)}`;
    }
    if (this.store.persistCommit) await this.store.persistCommit(next as BookingIntentAggregate & { [key: string]: unknown }, persistedOrder, result, actorId, input.idempotencyKey);
    else await this.store.save(next as BookingIntentAggregate & { [key: string]: unknown });
    if (this.store.saveCommitResult && !this.store.persistCommit) await this.store.saveCommitResult(actorId, input.idempotencyKey, result);
    else this.idempotency.set(`${actorId}:${input.idempotencyKey}`, result);
    return structuredClone(result);
  }

  async getSupplierOrder(orderId: string, actorId: string): Promise<SupplierOrderSnapshot> {
    const durableOrder = this.store.getSupplierOrder ? await this.store.getSupplierOrder(orderId) : null;
    const order = durableOrder ?? this.supplierOrders.get(orderId);
    if (!order) throw new ApplicationError('validation_error', 'supplier order not found');
    if (order.ownerId !== actorId) throw new ApplicationError('forbidden', 'supplier order belongs to another actor');
    if (order.snapshot.lifecycleStatus === 'creation_unknown') throw new ApplicationError('unknown_external_result', 'supplier order creation is unresolved');
    return structuredClone(order.snapshot);
  }

  async resolveRedirect(actorId: string, supplierId: string, token: string): Promise<RedirectResolution> {
    if (!actorId || !supplierId || !token || !this.redirects) throw new ApplicationError('validation_error', 'redirect context is required');
    let context;
    try {
      context = await this.redirects.verify(token, this.now(), { actorId, supplierId });
    } catch (error) {
      throw new ApplicationError('forbidden', error instanceof Error ? error.message : 'redirect token is invalid');
    }
    const durableOrder = this.store.getSupplierOrderForIntent ? await this.store.getSupplierOrderForIntent(context.intentId) : null;
    const order = durableOrder ?? [...this.supplierOrders.values()].find(value => value.intentId === context.intentId);
    if (!order || order.ownerId !== actorId || order.supplierId !== supplierId || !order.snapshot.paymentUrl) throw new ApplicationError('forbidden', 'redirect destination is not available');
    return { intentId: context.intentId, supplierId: context.supplierId, redirectUrl: order.snapshot.paymentUrl };
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
