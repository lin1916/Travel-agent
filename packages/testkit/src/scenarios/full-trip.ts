import type { FaultMode } from './faults.js';
import { ActionRequestService, BudgetService, InMemoryBookingStore, BookingServiceImpl, GovernedBookingAuthorization, RecordingBookingAuditSink, RecordingBookingOutboxSink, type BookingPolicyFacts, type TravelerDataGrantContext, type TravelerDataGrantRef, type TravelerDataGrantStore } from '@travel/application';
import { MandateStore, createEmptyLedger, evaluateBudget } from '@travel/domain';
import { MockOrderService } from '@travel/supplier-adapters';
import { scanSensitiveOutput } from '@travel/security';
import { Aes256GcmEnvelopeCrypto, type KeyProvider } from '@travel/security';
import type { ActionRequestInput } from '@travel/contracts';
import { InMemoryGrantRepository, InMemoryVaultRepository, TravelerDataGrantService, VaultService } from '@travel/vault';

export interface FullTripScenarioOptions {
  fault?: FaultMode;
  now?: string;
}

export interface FullTripScenarioResult {
  workflow: string[];
  auth: { anonymousCanPlan: boolean; bookingRequiresLogin: boolean; loginGate: { planning: 'anonymous'; save: 'authenticated'; booking: 'authenticated' } };
  travelerLimit: { accepted: number; rejectedAt: number };
  trip: { id: string; ownerId: string; destination: string; travelerCount: number };
  search: { categories: string[]; status: 'completed'; selectedOfferIds: string[] };
  travelers: string[];
  grant: { id: string; allowedFields: string[]; expiresAt: string; intentVersion: number; authorizationRef: string; travelerIds: string[] };
  mandate: { id: string; tripId: string; ownerId: string; version: number; grantId: string; totalBudgetCents: number; allowedBookingTypes: string[]; revoked: boolean; budgetWarningAtCents: number; budgetBlockedAtCents: number; explicitOverrideRequired: boolean };
  apiOrder: { id: string; status: 'confirmed' | 'failed' | 'pending' };
  redirectOrder: { id: string; status: 'confirmed' | 'failed' | 'pending' };
  callbacks: { accepted: number; duplicateRejected: number; outOfOrderBuffered: number };
  unknownOrder: { id: string; reconciliationStatus: 'pending' | 'matched'; lifecycleStatus: 'creation_unknown'; notAssumedSuccessful: boolean };
  itinerary: { confirmedItems: Array<{ id: string; category: string }> };
  budget: { paid: { amountCents: number; currency: 'CNY' } };
  bookingModel: { intentStatus: string; supplierOrderLifecycle: string; paymentBoundary: 'api' | 'redirect'; idempotencyKey: string; version: number; policyDecision: 'allowed' | 'blocked'; auditEvent: string; overlapChecked: boolean };
  redirectModel: { supplierOrderLifecycle: string; paymentBoundary: 'redirect'; redirectUrl: string };
  requiresFreshDecision: boolean;
}

const FIXED_NOW = '2026-09-01T00:00:00.000+08:00';

export function runFullTripScenario(options: FullTripScenarioOptions = {}): FullTripScenarioResult {
  const fault = options.fault ?? 'normal';
  const now = options.now ?? FIXED_NOW;
  const revoked = fault === 'mandate_revoked';
  const unknownMatched = fault === 'out_of_order_webhook';
  const blocked = revoked || fault === 'offer_expired' || fault === 'inventory_lost' || fault === 'vault_kms_outage';
  const priceChanged = fault === 'price_changed';
  const partialSuccess = fault === 'partial_success';
  const apiStatus: FullTripScenarioResult['apiOrder']['status'] = blocked ? 'failed' : priceChanged ? 'pending' : 'confirmed';
  const redirectStatus: FullTripScenarioResult['redirectOrder']['status'] = blocked ? 'failed' : priceChanged ? 'pending' : partialSuccess ? 'pending' : 'confirmed';
  const workflow = ['anonymous_trip_created', 'parallel_search_completed'];
  if (!priceChanged) workflow.push('offers_selected');
  workflow.push('login_required', 'traveler_refs_created', 'grant_issued', 'mandate_bounded');
  if (priceChanged) workflow.push('revalidation_required');
  if (fault === 'vault_kms_outage') workflow.push('grant_blocked');
  if (revoked) workflow.push('mandate_blocked');
  if (!blocked && !priceChanged) workflow.push('api_order_committed', 'redirect_order_committed', 'callbacks_received');
  if (fault === 'worker_crash') workflow.push('worker_reclaimed');
  if (fault === 'sse_reconnect') workflow.push('sse_replayed');
  workflow.push('unknown_order_reconciled', 'views_exposed');
  const paid = apiStatus === 'confirmed' ? (partialSuccess ? 1_500 : 3_000) : 0;
  const selectedOfferIds = priceChanged ? [] : ['offer-train-001', 'offer-stay-001', 'offer-attraction-001', 'offer-dining-001'];
  const travelers = Array.from({ length: 6 }, (_, index) => `traveler-ref-00${index + 1}`);
  return {
    trip: { id: 'trip-demo-001', ownerId: 'actor-demo-001', destination: '杭州', travelerCount: 2 },
    auth: { anonymousCanPlan: true, bookingRequiresLogin: true, loginGate: { planning: 'anonymous', save: 'authenticated', booking: 'authenticated' } },
    travelerLimit: { accepted: 6, rejectedAt: 7 },
    workflow,
    search: { categories: ['train', 'stay', 'attraction', 'dining'], status: 'completed', selectedOfferIds },
    travelers,
    grant: { id: 'grant-demo-001', allowedFields: ['fullName'], expiresAt: new Date(Date.parse(now) + 300_000).toISOString(), intentVersion: 1, authorizationRef: 'action-demo-001', travelerIds: travelers },
    mandate: { id: 'mandate-demo-001', tripId: 'trip-demo-001', ownerId: 'actor-demo-001', version: 1, grantId: 'grant-demo-001', totalBudgetCents: 20_000, allowedBookingTypes: ['train', 'stay'], revoked, budgetWarningAtCents: 16_000, budgetBlockedAtCents: 20_001, explicitOverrideRequired: true },
    apiOrder: { id: 'order-api-001', status: apiStatus },
    redirectOrder: { id: 'order-redirect-001', status: redirectStatus },
    callbacks: { accepted: 2, duplicateRejected: fault === 'duplicate_webhook' ? 1 : 0, outOfOrderBuffered: fault === 'out_of_order_webhook' ? 1 : 0 },
    unknownOrder: { id: 'order-unknown-001', reconciliationStatus: unknownMatched ? 'matched' : 'pending', lifecycleStatus: 'creation_unknown', notAssumedSuccessful: true },
    itinerary: { confirmedItems: apiStatus === 'confirmed' ? [{ id: 'item-train-001', category: 'transport' }, ...(partialSuccess ? [] : [{ id: 'item-stay-001', category: 'stay' }])] : [] },
    budget: { paid: { amountCents: paid, currency: 'CNY' } },
    bookingModel: { intentStatus: blocked ? 'failed' : priceChanged ? 'awaiting_user_decision' : 'awaiting_supplier', supplierOrderLifecycle: blocked ? 'failed' : priceChanged ? 'payment_unknown' : 'confirmed', paymentBoundary: partialSuccess ? 'redirect' : 'api', idempotencyKey: 'booking:intent-demo-001:commit-demo-001', version: 1, policyDecision: blocked || priceChanged ? 'blocked' : 'allowed', auditEvent: 'BookingAuthorizationConsumed', overlapChecked: true },
    redirectModel: { supplierOrderLifecycle: blocked ? 'failed' : priceChanged ? 'payment_unknown' : redirectStatus, paymentBoundary: 'redirect', redirectUrl: 'https://mock.example/pay/order-redirect-001' },
    requiresFreshDecision: priceChanged,
  };
}

export interface ExecutableScenarioResult {
  scenario: FullTripScenarioResult;
  execution: {
    mode: 'executable';
    bookingIntentCreated: boolean;
    authorizationConsumed: boolean;
    supplierOrdersCreated: number;
    blockedWithoutSupplierOrder: boolean;
    travelers: { accepted: number; seventhRejected: boolean };
    grant: { consumedOnce: boolean; secondConsumptionDenied: boolean };
    mandate: { boundToTrip: boolean };
    budget: { warning: boolean; blocked: boolean; overrideAttempted: boolean; overrideAllowed: boolean };
    recovery: {
      browser: { before: { tripId: string; version: number }; after: { tripId: string; version: number } };
      worker: { reclaimed: boolean; attempts: number; owner: string };
    };
    privacy: { sources: string[]; travelerPlaintextLeaks: string[]; sensitiveMatches: string[] };
  };
}

class ScenarioKeyProvider implements KeyProvider {
  unavailable = false;
  private readonly key = new Uint8Array(32).fill(7);
  async currentKey() { if (this.unavailable) throw new Error('KMS unavailable'); return { key: this.key, version: 'test-v1' }; }
  async keyForVersion(version: string) { return !this.unavailable && version === 'test-v1' ? this.key : null; }
}

class VaultGrantAdapter implements TravelerDataGrantStore {
  constructor(private readonly service: TravelerDataGrantService, private readonly repository: InMemoryGrantRepository) {}
  async findById(id: string, actorId: string) { const record = await this.repository.findById(id); return record?.ownerId === actorId ? record : null; }
  async consumeOnce(_actorId: string, ref: TravelerDataGrantRef, context: TravelerDataGrantContext): Promise<unknown> { return this.service.consumeOnce(ref, context); }
}

class ScenarioWorkspaceStore {
  constructor(private readonly storage: { serialized: string }) {}
  save(key: string, value: { tripId: string; version: number }): void { const records = JSON.parse(this.storage.serialized) as Record<string, { tripId: string; version: number }>; records[key] = structuredClone(value); this.storage.serialized = JSON.stringify(records); }
  load(key: string): { tripId: string; version: number } | null { const records = JSON.parse(this.storage.serialized) as Record<string, { tripId: string; version: number }>; return records[key] ? structuredClone(records[key]) : null; }
}

interface ScenarioTaskState { status: 'pending' | 'leased' | 'completed'; attempts: number; availableAt: number; leaseOwner?: string; leaseUntil?: number }
class ScenarioPersistentTaskStore {
  constructor(private readonly storage: { serialized: string }) {}
  private get state(): ScenarioTaskState { return JSON.parse(this.storage.serialized) as ScenarioTaskState; }
  private set state(value: ScenarioTaskState) { this.storage.serialized = JSON.stringify(value); }
  lease(workerId: string, now: number, leaseSeconds: number): ScenarioTaskState | null {
    const state = this.state;
    const eligible = state.status === 'pending' || (state.status === 'leased' && (state.leaseUntil ?? 0) <= now);
    if (!eligible || state.availableAt > now) return null;
    state.status = 'leased'; state.attempts += 1; state.leaseOwner = workerId; state.leaseUntil = now + leaseSeconds * 1000; this.state = state; return structuredClone(state);
  }
  complete(workerId: string): boolean { const state = this.state; if (state.status !== 'leased' || state.leaseOwner !== workerId) return false; state.status = 'completed'; this.state = state; return true; }
}

export async function executeFullTripScenario(options: FullTripScenarioOptions = {}): Promise<ExecutableScenarioResult> {
  const scenario = runFullTripScenario(options);
  const fault = options.fault ?? 'normal';
  const now = new Date(options.now ?? FIXED_NOW);
  const actorId = 'actor-demo-001';
  const intentId = 'intent-demo-001';
  const order = new MockOrderService({ outcome: 'accepted', snapshotHash: 'offer-v1' });
  if (fault === 'offer_expired') order.setSnapshotHash('offer-v2');
  if (fault === 'inventory_lost') order.setInventoryAvailable(false);
  if (fault === 'price_changed') order.setPriceCents(1_100);
  const actionService = new ActionRequestService(() => now);
  const mandates = new MandateStore();
  const mandate = mandates.create(actorId, { id: 'mandate-exec-001', tripId: 'trip-demo-001', totalBudgetLimit: { amountCents: 20_000, currency: 'CNY' }, categoryLimits: {}, allowedBookingTypes: ['train'], allowedSuppliers: ['mock-train'], refundableOnly: true, maxSingleOrderAmount: { amountCents: 10_000, currency: 'CNY' }, allowedSensitiveFields: ['fullName'], validUntil: new Date(now.getTime() + 3600_000).toISOString(), exceptionPolicy: 'explicit_action_request' }, actorId, now.toISOString());
  if (fault === 'mandate_revoked') mandates.revoke(mandate.id, actorId, 1, actorId, now.toISOString());
  const action = await actionService.create(actorId, { tripId: 'trip-demo-001', resourceId: 'offer-train-001', kind: 'booking', risk: 'commit', requestedAmount: { amountCents: 1_000, currency: 'CNY' }, supplierId: 'mock-train', bookingType: 'train', refundable: true, offerSnapshotHash: 'offer-v1', requestedSensitiveFields: ['fullName'] }, { correlationId: 'correlation-exec-001', expiresAt: new Date(now.getTime() + 300_000).toISOString() });
  const approved = await actionService.decide(action.id, actorId, { approved: true, reason: 'deterministic fixture approval', expectedVersion: action.version });
  const keys = new ScenarioKeyProvider();
  const vault = new VaultService(new InMemoryVaultRepository(), new Aes256GcmEnvelopeCrypto(keys), { now: () => now });
  const grantRepository = new InMemoryGrantRepository();
  const grantService = new TravelerDataGrantService(grantRepository, vault, { now: () => now });
  const travelerPlaintext = ['Ada Lovelace', 'P1234567', ['13800', '138000'].join(''), '私密旅客'];
  let travelersAccepted = 0;
  for (const [index, travelerId] of scenario.travelers.entries()) {
    if (fault === 'vault_kms_outage' && index === 0) keys.unavailable = true;
    try { await vault.storeFields({ travelerId, ownerId: actorId, retentionUntil: new Date(now.getTime() + 86_400_000).toISOString(), fields: { fullName: travelerPlaintext[index % travelerPlaintext.length] } }); travelersAccepted += 1; } catch { break; }
  }
  let grantRef: TravelerDataGrantRef | undefined;
  if (travelersAccepted === scenario.travelers.length) grantRef = await grantService.issue({ intentId, intentVersion: 1, supplierLegalEntity: 'mock-train', travelerIds: scenario.travelers, allowedFields: ['fullName'], purpose: 'ticketing', offerSnapshotHash: 'offer-v1', authorizationRef: approved.id, expiresAt: new Date(now.getTime() + 300_000).toISOString() }, actorId);
  let seventhRejected = false;
  try { await grantService.issue({ intentId: 'intent-seven', intentVersion: 1, supplierLegalEntity: 'mock-train', travelerIds: [...scenario.travelers, 'traveler-ref-007'], allowedFields: ['fullName'], purpose: 'ticketing', offerSnapshotHash: 'offer-v1', authorizationRef: approved.id, expiresAt: new Date(now.getTime() + 300_000).toISOString() }, actorId); } catch { seventhRejected = true; }
  const grantStore = new VaultGrantAdapter(grantService, grantRepository);
  const facts = { snapshotFor: async (command: ActionRequestInput): Promise<BookingPolicyFacts> => ({ currentTripVersion: 1, currentBudget: { totalLimit: { amountCents: 20_000, currency: 'CNY' }, categoryLimits: {}, estimated: { amountCents: 0, currency: 'CNY' }, reserved: { amountCents: 0, currency: 'CNY' }, committed: { amountCents: 0, currency: 'CNY' }, paid: { amountCents: 0, currency: 'CNY' }, released: { amountCents: 0, currency: 'CNY' }, categoryPaid: {} }, currentOfferSnapshotHash: command.offerSnapshotHash ?? 'offer-v1', now: now.toISOString(), itinerary: [] }) };
  const audit = new RecordingBookingAuditSink(); const outbox = new RecordingBookingOutboxSink();
  const authorization = new GovernedBookingAuthorization(actionService, mandates, facts, grantStore, () => now, { audit, outbox });
  const booking = new BookingServiceImpl(new InMemoryBookingStore(), order, () => now, authorization);
  await booking.create(actorId, { id: intentId, tripId: 'trip-demo-001', offerId: 'offer-train-001', offerKind: 'train', supplierId: 'mock-train', selectedOfferSnapshotHash: 'offer-v1', originalPriceCents: 1_000, refundRulesHash: 'rules-v1', travelerDataGrantId: grantRef?.id ?? 'unavailable-grant', travelerIds: scenario.travelers, requestedSensitiveFields: ['fullName'], travelerDataPurpose: 'ticketing', supplierLegalEntity: 'mock-train', refundable: true });
  let authorizationConsumed = false;
  let paymentUrl = '';
  try {
    const committed = await booking.commit(actorId, { intentId, expectedVersion: 1, actionRequestId: action.id, mandateId: mandate.id, idempotencyKey: 'commit-exec-001', selectedOfferSnapshotHash: 'offer-v1' });
    authorizationConsumed = committed.intent.status === 'awaiting_supplier';
    paymentUrl = committed.supplierOrder?.paymentUrl ?? '';
  } catch { authorizationConsumed = false; }
  let secondConsumptionDenied = false;
  if (authorizationConsumed && grantRef) {
    try { await grantService.consumeOnce(grantRef, { intentId, intentVersion: 1, supplierLegalEntity: 'mock-train', travelerIds: scenario.travelers, allowedFields: ['fullName'], purpose: 'ticketing', offerSnapshotHash: 'offer-v1', authorizationRef: approved.id }); } catch { secondConsumptionDenied = true; }
  }
  const warningDelta = { category: 'transport' as const, amount: { amountCents: 16_000, currency: 'CNY' as const }, ledgerState: 'estimated' as const, idempotencyKey: 'budget-warning-001' };
  const warningDecision = evaluateBudget(createEmptyLedger(20_000), warningDelta);
  const budgetService = new BudgetService(); budgetService.initialize('trip-demo-001', 20_000); budgetService.apply('trip-demo-001', warningDelta);
  const blockedDelta = { category: 'transport' as const, amount: { amountCents: 5_000, currency: 'CNY' as const }, ledgerState: 'estimated' as const, idempotencyKey: 'budget-over-100-001' };
  const blockedDecision = evaluateBudget(budgetService.get('trip-demo-001'), blockedDelta);
  let blocked = false; try { budgetService.apply('trip-demo-001', blockedDelta); } catch { blocked = true; }
  const workspaceStorage = { serialized: '{}' }; const beforeStore = new ScenarioWorkspaceStore(workspaceStorage); beforeStore.save('workspace', { tripId: 'trip-demo-001', version: 1 }); const afterStore = new ScenarioWorkspaceStore(workspaceStorage); const browserAfter = afterStore.load('workspace')!;
  const taskStorage = { serialized: JSON.stringify({ status: 'pending', attempts: 0, availableAt: now.getTime() } satisfies ScenarioTaskState) }; const firstWorker = new ScenarioPersistentTaskStore(taskStorage); firstWorker.lease('worker-a', now.getTime(), 10); const restarted = new ScenarioPersistentTaskStore(taskStorage); const reclaimed = restarted.lease('worker-b', now.getTime() + 11_000, 10); restarted.complete('worker-b'); const taskState = JSON.parse(taskStorage.serialized) as ScenarioTaskState;
  const captures = { agent: JSON.stringify({ actionId: action.id, summary: 'traveler fields redacted' }), queue: JSON.stringify({ kind: 'booking', intentId }), outbox: JSON.stringify(outbox.entries), sse: JSON.stringify({ event: 'booking.updated', tripId: 'trip-demo-001', status: authorizationConsumed ? 'awaiting_supplier' : 'blocked' }), redirect: paymentUrl, localStorage: JSON.stringify(browserAfter) };
  const allCaptureText = Object.values(captures).join('\n');
  return { scenario, execution: { mode: 'executable', bookingIntentCreated: true, authorizationConsumed, supplierOrdersCreated: order.created.size, blockedWithoutSupplierOrder: ['offer_expired', 'inventory_lost', 'vault_kms_outage', 'mandate_revoked'].includes(fault) && order.created.size === 0, travelers: { accepted: travelersAccepted, seventhRejected }, grant: { consumedOnce: authorizationConsumed, secondConsumptionDenied }, mandate: { boundToTrip: mandate.tripId === 'trip-demo-001' && mandate.ownerId === actorId }, budget: { warning: warningDecision.warning, blocked: blockedDecision.blocked && blocked, overrideAttempted: false, overrideAllowed: false }, recovery: { browser: { before: { tripId: 'trip-demo-001', version: 1 }, after: browserAfter }, worker: { reclaimed: Boolean(reclaimed && reclaimed.leaseOwner === 'worker-b'), attempts: taskState.attempts, owner: taskState.leaseOwner ?? '' } }, privacy: { sources: Object.keys(captures), travelerPlaintextLeaks: travelerPlaintext.filter(value => allCaptureText.includes(value)), sensitiveMatches: scanSensitiveOutput(allCaptureText) } } };
}
