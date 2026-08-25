# Travel Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a responsive, API-first domestic travel assistant that can plan and compare transport, stays, attractions, and dining, enforce budget/time/privacy policies, and execute recoverable mock/sandbox bookings with supplier redirects, callbacks, reconciliation, and after-sales tracking.

**Architecture:** Use a TypeScript modular monolith with separate API, Worker, and Vault runtime units. The Agent Runtime can invoke only allow-listed deterministic capabilities through the Capability Gateway; PostgreSQL is the source of truth for domain state, tasks, outbox/inbox records, event history, and idempotency. Supplier adapters translate protocols but never mutate domain state.

**Tech Stack:** pnpm workspaces, React + TypeScript + Vite, React Router, TanStack Query, Zod, Node.js + TypeScript, NestJS on Fastify, PostgreSQL + pg + Kysely, SSE, Vitest, Playwright, Pino, Prometheus-compatible metrics, Docker Compose, and provider-neutral LLM/identity/KMS interfaces with deterministic local implementations.

**Spec:** docs/superpowers/specs/2026-08-25-travel-agent-design.md

## Global Constraints

- Product scope is mainland China domestic travel, CNY, China Standard Time, and at most 6 travelers per Trip.
- Trains and flights are searchable/bookable; subway, bus, and taxi provide estimates only.
- Anonymous users can plan; login is required before saving traveler data or booking.
- Default behavior is per-order user confirmation. A user-created TravelMandate may authorize bounded autonomous execution, but payment always occurs on the supplier page.
- Budget warnings occur at 80%; exceeding 100% blocks by default and requires an explicit, auditable override.
- Direct itinerary overlaps are blocked; transport buffers and activity rhythm are warnings only.
- BookingIntent and SupplierOrder are separate aggregates. SupplierOrder lifecycle and reconciliation status are separate state machines.
- SupplierAdapter only translates supplier protocols. Domain services own state transitions, invariants, idempotency, and audit.
- Agent Runtime never directly accesses SQL, supplier HTTP, Vault plaintext, payment data, or unrestricted tools.
- Every external side effect requires an idempotency key, optimistic version check, policy check, and audit record.
- Unknown supplier creation or payment outcomes are never shown as success and must enter query, reconciliation, or manual review.
- Traveler plaintext must not enter LLM context, logs, traces, queues, caches, vector stores, SSE payloads, URLs, or browser local storage.
- TravelerDataGrant is bound to intent version, supplier legal entity, traveler, purpose, offer snapshot, expiry, and one use.
- PostgreSQL is the business source of truth. V1 does not use Kafka, a service mesh, distributed transactions, or Redis as a fact store.
- All async work is recoverable through PostgreSQL tasks, leases, Outbox/Inbox, event history, and SSE Last-Event-ID replay.
- No production supplier or payment credential is required for local development; Mock/Sandbox adapters must exercise the full workflow.
- Do not start business implementation until the executing engineer has read the approved spec and this plan.

## Repository Map

The repository is currently empty apart from the approved design document and the generated-artifact ignore rule. The implementation creates these focused units:

~~~text
apps/web/
  src/main.tsx
  src/routes/
  src/features/
  src/components/
  src/lib/api-client.ts
  src/styles/
  tests/

apps/api/
  src/main.ts
  src/app.module.ts
  src/modules/
  test/

apps/worker/
  src/main.ts
  src/jobs/
  test/

apps/vault/
  src/main.ts
  src/modules/
  test/

packages/contracts/
  src/
  test/

packages/domain/
  src/
  test/

packages/application/
  src/
  test/

packages/capability-gateway/
  src/
  test/

packages/agent-runtime/
  src/
  test/

packages/supplier-adapters/
  src/
  fixtures/
  test/

packages/persistence/
  src/
  migrations/
  test/

packages/security/
  src/
  test/

packages/observability/
  src/
  test/

packages/testkit/
  src/

infra/
  compose.yaml
  postgres/

docs/api/
docs/runbooks/
~~~

## Task 1: Bootstrap the Monorepo and Health-Check Slice

**Files:**

- Create: package.json
- Create: pnpm-workspace.yaml
- Create: turbo.json
- Create: tsconfig.base.json
- Create: .editorconfig
- Create: .env.example
- Create: apps/api/package.json
- Create: apps/api/tsconfig.json
- Create: apps/api/src/main.ts
- Create: apps/api/src/app.module.ts
- Create: apps/api/src/health/health.controller.ts
- Create: apps/api/test/health.e2e-spec.ts
- Create: apps/web/package.json
- Create: apps/web/index.html
- Create: apps/web/src/main.tsx
- Create: apps/web/src/App.tsx
- Create: apps/worker/package.json
- Create: apps/worker/src/main.ts
- Create: apps/vault/package.json
- Create: apps/vault/src/main.ts
- Create: infra/compose.yaml
- Create: packages/testkit/package.json

**Interfaces:**

- Name runtime packages @travel/api, @travel/web, @travel/worker, @travel/vault, and @travel/testkit so every filter command in this plan resolves exactly.
- Add @nestjs/testing, supertest, vitest, typescript, and eslint to the API development dependencies; add Playwright to Web development dependencies; add the shared test runner and TypeScript config to every package.
- Define root scripts: dev, build, typecheck, lint, test, test:integration, test:e2e, db:migrate, security:scan-sensitive-output, and ci. The ci script runs typecheck, lint, test, test:integration, test:e2e, and the sensitive-output scan in that order.
- Produces an API process exposing GET /health with { "status": "ok", "service": "api" }.
- Produces a Web process rendering a non-empty “旅行工作台” shell.
- Produces Worker and Vault processes that start and expose a process-level readiness log.
- All packages use the same TypeScript target, strict mode, lint command, and test command.

- [ ] **Step 1: Add the failing health contract test**

Create apps/api/test/health.e2e-spec.ts with a Supertest request against the Nest application:

~~~ts
it('returns a stable readiness payload', async () => {
  const response = await request(app.getHttpServer()).get('/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok', service: 'api' });
});
~~~

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: pnpm --filter @travel/api test -- health.e2e-spec.ts

Expected: FAIL because the workspace and health controller do not exist.

- [ ] **Step 3: Add workspace configuration and minimal processes**

Use pnpm workspace filters and a Turbo pipeline for dev, build, test, lint, and typecheck. Configure NestJS with FastifyAdapter, Vite for Web, and one start entry point for Worker/Vault. Keep secrets in environment variables listed in .env.example; do not place credentials in source.

- [ ] **Step 4: Implement the health controller and Web shell**

Return the exact payload above, set a JSON content type, and render a responsive shell with a main landmark and an empty-state heading. Do not add booking behavior in this task.

- [ ] **Step 5: Run the focused test, typecheck, and build**

Run: pnpm --filter @travel/api test -- health.e2e-spec.ts

Run: pnpm typecheck

Run: pnpm build

Expected: the health test passes, typecheck exits 0, and all four runtime packages build.

- [ ] **Step 6: Commit the bootstrap slice**

~~~text
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .editorconfig .env.example apps infra packages
git commit -m "chore: bootstrap travel agent workspace"
~~~

## Task 2: Define Shared Contracts and Error Semantics

**Files:**

- Create: packages/contracts/src/money.ts
- Create: packages/contracts/src/trip.ts
- Create: packages/contracts/src/search.ts
- Create: packages/contracts/src/booking.ts
- Create: packages/contracts/src/mandate.ts
- Create: packages/contracts/src/action-request.ts
- Create: packages/contracts/src/events.ts
- Create: packages/contracts/src/errors.ts
- Create: packages/contracts/src/index.ts
- Create: packages/contracts/test/contracts.test.ts
- Create: packages/contracts/test/state-machine-contract.test.ts

**Interfaces:**

- Produces stable types consumed by API, Worker, Gateway, Agent Runtime, adapters, and Web.
- Core scalar contracts:

~~~ts
type Currency = 'CNY';
type TravelCategory = 'transport' | 'stay' | 'attraction' | 'dining';
type OfferKind = 'train' | 'flight' | 'stay' | 'attraction' | 'dining';
type RiskLevel = 'read' | 'prepare' | 'commit' | 'redirect';
type CreateOrderResult = 'accepted' | 'pending' | 'rejected' | 'indeterminate';
type BookingIntentStatus =
  | 'draft'
  | 'awaiting_user_decision'
  | 'validating'
  | 'awaiting_traveler_data_grant'
  | 'submitting'
  | 'awaiting_supplier'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelling'
  | 'cancelled';
type SupplierOrderLifecycle =
  | 'creating'
  | 'creation_unknown'
  | 'awaiting_payment'
  | 'payment_processing'
  | 'payment_unknown'
  | 'paid'
  | 'confirmed'
  | 'cancelling'
  | 'cancelled'
  | 'refunding'
  | 'refunded'
  | 'failed'
  | 'expired';
type ReconciliationStatus =
  | 'not_required'
  | 'pending'
  | 'matched'
  | 'discrepancy'
  | 'manual_review';

interface Money {
  amountCents: number;
  currency: Currency;
}

interface Versioned {
  id: string;
  version: number;
}

interface ItineraryItem extends Versioned {
  tripId: string;
  category: TravelCategory;
  startsAt: string;
  endsAt: string;
  location?: { city: string; latitude?: number; longitude?: number };
  offerId?: string;
  supplierOrderId?: string;
  confirmed: boolean;
}

interface BudgetLedger {
  totalLimit: Money;
  categoryLimits: Partial<Record<TravelCategory, Money>>;
  estimated: Money;
  reserved: Money;
  committed: Money;
  paid: Money;
  released: Money;
  categoryPaid: Partial<Record<TravelCategory, Money>>;
}

interface TripRecord extends Versioned {
  ownerId: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  travelerCount: number;
}

interface TimeConflict {
  candidateId: string;
  existingId: string;
  startsAt: string;
  endsAt: string;
}

interface ItineraryWarning {
  code: 'transfer_tight' | 'airport_advance' | 'rhythm';
  message: string;
  severity: 'info' | 'warning';
}

interface RouteEstimator {
  estimate(from: string, to: string, at: string): Promise<{ minutes: number }>;
}

interface BudgetDelta {
  category: TravelCategory;
  amount: Money;
  ledgerState: 'estimated' | 'reserved' | 'committed' | 'paid' | 'released';
  idempotencyKey: string;
}

interface BudgetDecision {
  allowed: boolean;
  warning: boolean;
  blocked: boolean;
  totalAfter: Money;
  categoryAfter: Money;
  reasons: string[];
}

interface TravelMandate {
  id: string;
  tripId: string;
  version: number;
  totalBudgetLimit: Money;
  categoryLimits: Partial<Record<TravelCategory, Money>>;
  allowedBookingTypes: OfferKind[];
  allowedSuppliers: string[];
  refundableOnly: boolean;
  maxSingleOrderAmount: Money;
  allowedSensitiveFields: string[];
  validUntil: string;
  exceptionPolicy: string;
  revokedAt?: string;
}

interface PolicyReason {
  code: string;
  message: string;
  blocking: boolean;
}

interface PolicySnapshot {
  currentTripVersion: number;
  currentBudget: BudgetLedger;
  currentOfferSnapshotHash: string;
  now: string;
}

interface CreateOrderResponse {
  outcome: CreateOrderResult;
  supplierOrderRef?: string;
  paymentUrl?: string;
  redirectUrl?: string;
}

interface SupplierOrderRef {
  supplierId: string;
  supplierOrderId: string;
}

interface RevalidateRequest {
  supplierId: string;
  offerSnapshotHash: string;
  offerId: string;
}

interface CreateSupplierOrder {
  intentId: string;
  offerSnapshotHash: string;
  travelerDataGrantId: string;
  executionAuthorizationRef: string;
  externalIdempotencyKey: string;
}

interface SupplierOrderSnapshot {
  lifecycleStatus: SupplierOrderLifecycle;
  reconciliationStatus: ReconciliationStatus;
  supplierOrderRef?: SupplierOrderRef;
  paymentUrl?: string;
  confirmationRef?: string;
}

interface RevalidatedOffer {
  offerId: string;
  snapshotHash: string;
  price: Money;
  inventoryAvailable: boolean;
  refundRulesHash: string;
}

interface SupplierWebhook {
  supplierId: string;
  rawBody: Uint8Array;
  headers: Record<string, string>;
}

interface SupplierOrderUpdate {
  externalEventId: string;
  orderRef: SupplierOrderRef;
  lifecycleStatus: SupplierOrderLifecycle;
  paymentVerified: boolean;
}

interface CancelSupplierOrder {
  orderRef: SupplierOrderRef;
  externalIdempotencyKey: string;
}

interface CancelResult {
  outcome: 'accepted' | 'completed' | 'rejected' | 'indeterminate';
  refundAmount?: Money;
}

interface EventEnvelope {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  run_id?: string;
  sequence: number;
  schema_version: number;
  occurred_at: string;
  request_id: string;
  correlation_id: string;
  redacted_payload: Record<string, unknown>;
}

type TaskKind =
  | 'search'
  | 'booking'
  | 'supplier_poll'
  | 'reconciliation'
  | 'outbox_dispatch'
  | 'webhook_update';

interface TaskOutcome {
  status: 'completed' | 'retry' | 'dead_letter';
  retryAt?: string;
  reason?: string;
}
~~~

- Produces exact BookingIntent and SupplierOrder status unions from the spec, plus event envelope fields event_id, event_type, aggregate_type, aggregate_id, run_id, sequence, schema_version, occurred_at, request_id, correlation_id, and redacted_payload.
- Produces a discriminated AppError shape with code, httpStatus, retryable, publicMessage, and correlationId. Sensitive provider messages stay in a redacted internal detail field and are never serialized to clients.
- Produces ActionRequest input/view types, CancelRequest, RefundRequest, TaskKind, TaskOutcome, AuditEntry, AuditView, LogEvent, and the RevalidateRequest/CreateSupplierOrder/SupplierOrderSnapshot contracts used by later tasks.

- [ ] **Step 1: Write failing contract assertions**

Test that a non-CNY Money object is rejected by the runtime schema, that amountCents is an integer at least zero, and that an event envelope cannot omit sequence or schema_version.

- [ ] **Step 2: Run the contract tests and verify failure**

Run: pnpm --filter @travel/contracts test

Expected: FAIL because the contract modules and schemas are absent.

- [ ] **Step 3: Implement types and runtime schemas**

Use Zod schemas colocated with the exported TypeScript types. Parse untrusted HTTP, supplier, webhook, and model output at the boundary. Keep domain objects independent of NestJS decorators.

- [ ] **Step 4: Add error mapping tests**

Cover validation_error (400), unauthorized (401), forbidden (403), conflict (409), policy_blocked (422), supplier_unavailable (503), and unknown_external_result (202). Assert that publicMessage contains no input field values.

- [ ] **Step 5: Run tests and typecheck**

Run: pnpm --filter @travel/contracts test

Run: pnpm --filter @travel/contracts typecheck

Expected: all schema and error tests pass.

- [ ] **Step 6: Commit the contracts**

~~~text
git add packages/contracts
git commit -m "feat: define travel agent contracts"
~~~

## Task 3: Build PostgreSQL Persistence, Migrations, and Idempotency

**Files:**

- Create: infra/postgres/init.sql
- Create: packages/persistence/src/db.ts
- Create: packages/persistence/src/types.ts
- Create: packages/persistence/migrations/001_core.ts
- Create: packages/persistence/src/repositories/trip-repository.ts
- Create: packages/persistence/src/repositories/event-repository.ts
- Create: packages/persistence/src/repositories/idempotency-repository.ts
- Create: packages/persistence/src/repositories/task-repository.ts
- Create: packages/persistence/src/outbox/outbox-repository.ts
- Create: packages/persistence/src/inbox/inbox-repository.ts
- Create: packages/persistence/src/index.ts
- Create: packages/persistence/test/repositories.integration.test.ts
- Create: packages/persistence/test/idempotency.integration.test.ts
- Modify: infra/compose.yaml

**Interfaces:**

- TripRepository.create(input): Promise<TripRecord>
- TripRepository.getForOwner(tripId, ownerId): Promise<TripRecord | null>
- TripRepository.updateVersioned(tripId, ownerId, expectedVersion, patch): Promise<TripRecord>
- IdempotencyRepository.claim(scope, key, requestHash): Promise<'claimed' | 'replay' | 'conflict'>
- TaskRepository.lease(workerId, now, leaseSeconds): Promise<TaskRecord | null>
- OutboxRepository.append(tx, event): Promise<void>
- EventRepository.appendAndPublishable(tx, event): Promise<void>

Tables created in this task: trips, idempotency_keys, tasks, outbox_events, inbox_messages, event_log. Add unique indexes for owner/resource/idempotency scope, aggregate_id + sequence, and external event IDs.

- [ ] **Step 1: Write failing repository tests against PostgreSQL**

Start PostgreSQL with infra/compose.yaml. Test that a Trip version starts at 1, an update with the wrong expected version returns a conflict, and a repeated idempotency key with the same request hash returns replay.

- [ ] **Step 2: Run the tests and verify the expected database failure**

Run: docker compose -f infra/compose.yaml up -d postgres

Run: pnpm --filter @travel/persistence test -- repositories.integration.test.ts

Expected: FAIL because migrations and repositories are absent.

- [ ] **Step 3: Implement Kysely connection and migrations**

Use one explicit transaction for state mutation plus Outbox insertion. Configure statement timeouts and pool limits from environment variables. Store monetary values as integer cents and timestamps as UTC instants; convert to CST only at presentation boundaries.

- [ ] **Step 4: Implement optimistic version and idempotency queries**

The update SQL must include WHERE id = ? AND owner_id = ? AND version = ?. The idempotency claim must compare a canonical JSON request hash and return conflict for the same key with a different hash.

- [ ] **Step 5: Implement task lease and event repositories**

Lease one pending task with FOR UPDATE SKIP LOCKED, set lease_owner and lease_until atomically, and make expired leases reclaimable. Event sequence allocation must be scoped to one aggregate.

- [ ] **Step 6: Run integration tests and a migration rollback check**

Run: pnpm --filter @travel/persistence test

Run: pnpm --filter @travel/persistence typecheck

Run: pnpm db:migrate

Expected: all repository tests pass; applying migrations twice is harmless; no test truncation bypasses foreign keys.

- [ ] **Step 7: Commit persistence**

~~~text
git add infra/compose.yaml infra/postgres packages/persistence
git commit -m "feat: add postgres persistence primitives"
~~~

## Task 4: Implement Deterministic Trip, Itinerary, Budget, and Time Rules

**Files:**

- Create: packages/domain/src/trip/trip.ts
- Create: packages/domain/src/itinerary/overlap.ts
- Create: packages/domain/src/itinerary/warnings.ts
- Create: packages/domain/src/budget/ledger.ts
- Create: packages/domain/src/budget/policy.ts
- Create: packages/domain/src/clock.ts
- Create: packages/domain/src/index.ts
- Create: packages/domain/test/overlap.test.ts
- Create: packages/domain/test/budget.test.ts
- Create: packages/domain/test/property-invariants.test.ts
- Create: packages/application/src/trips/trip-service.ts
- Create: packages/application/src/itinerary/itinerary-service.ts
- Create: packages/application/src/budget/budget-service.ts
- Create: apps/api/src/modules/trips/trip.controller.ts
- Create: apps/api/src/modules/trips/trip.module.ts
- Create: apps/api/src/modules/itinerary/itinerary.controller.ts
- Create: apps/api/src/modules/itinerary/itinerary.module.ts
- Create: apps/api/src/modules/budget/budget.controller.ts
- Create: apps/api/src/modules/budget/budget.module.ts
- Create: apps/api/test/trip-rules.e2e-spec.ts
- Create: packages/persistence/migrations/002_itinerary_budget.ts
- Create: packages/application/test/application-rules.test.ts

**Interfaces:**

~~~ts
function findDirectOverlaps(
  confirmedItems: ReadonlyArray<ItineraryItem>,
  candidate: ItineraryItem,
): TimeConflict[];

function evaluateBudget(
  ledger: BudgetLedger,
  delta: BudgetDelta,
): BudgetDecision;

function buildSoftWarnings(
  itinerary: ReadonlyArray<ItineraryItem>,
  routeEstimator: RouteEstimator,
): Promise<ItineraryWarning[]>;
~~~

BudgetDecision must contain allowed, warning, blocked, totalAfter, categoryAfter, and reasons. It must never use floating-point currency arithmetic.

- [ ] **Step 1: Write failing domain tests**

Cover touching intervals (allowed), overlapping intervals (blocked), 80% threshold warning, 100% threshold blocking, explicit override carrying a decision reference, category limits, and ledger conservation across reserved/committed/paid/released.

- [ ] **Step 2: Run the domain tests and verify failure**

Run: pnpm --filter @travel/domain test

Expected: FAIL because the domain functions are absent.

- [ ] **Step 3: Implement overlap and budget calculations**

Use half-open intervals [start, end) so an item ending at 10:00 and another starting at 10:00 do not conflict. Compare integer cents and return structured reasons rather than natural-language-only errors.

- [ ] **Step 4: Implement warning-only route and rhythm checks**

Call RouteEstimator for city transfer, airport/train advance, and activity rhythm. Never turn these warnings into a blocking error.

- [ ] **Step 5: Expose Trip, itinerary, and budget commands**

Implement POST /v1/trips, GET /v1/trips/{tripId}, GET /v1/trips/{tripId}/itinerary, and GET /v1/trips/{tripId}/budget. Route mutations through the application services and require owner/version checks.

- [ ] **Step 6: Add property tests**

Generate non-negative ledger deltas and assert total never becomes negative, released amounts never exceed prior reserved/committed/paid amounts, and reapplying the same idempotent delta does not change the result.

- [ ] **Step 7: Run tests and commit**

Run: pnpm --filter @travel/domain test

Run: pnpm --filter @travel/application test

Run: pnpm --filter @travel/api test -- trip-rules.e2e-spec.ts

~~~text
git add packages/domain packages/application apps/api/src/modules/trips apps/api/src/modules/itinerary apps/api/src/modules/budget apps/api/test/trip-rules.e2e-spec.ts packages/persistence/migrations/002_itinerary_budget.ts
git commit -m "feat: enforce itinerary and budget rules"
~~~

## Task 5: Add Supplier Contracts, Mock Adapters, Search Normalization, and Ranking

**Files:**

- Create: packages/supplier-adapters/src/adapter.ts
- Create: packages/supplier-adapters/src/mock/mock-transport-adapter.ts
- Create: packages/supplier-adapters/src/mock/mock-stay-adapter.ts
- Create: packages/supplier-adapters/src/mock/mock-attraction-adapter.ts
- Create: packages/supplier-adapters/src/mock/mock-dining-adapter.ts
- Create: packages/supplier-adapters/src/mock/fault-mode.ts
- Create: packages/supplier-adapters/fixtures/transport.json
- Create: packages/supplier-adapters/fixtures/stay.json
- Create: packages/supplier-adapters/fixtures/attraction.json
- Create: packages/supplier-adapters/fixtures/dining.json
- Create: packages/supplier-adapters/src/index.ts
- Create: packages/application/src/search/search-service.ts
- Create: packages/application/src/search/normalizer.ts
- Create: packages/application/src/search/ranker.ts
- Create: packages/application/test/search-service.test.ts
- Create: packages/supplier-adapters/test/adapter-contract.test.ts
- Create: apps/api/src/modules/search/search.controller.ts
- Create: apps/api/src/modules/search/search.module.ts
- Create: apps/api/test/search.e2e-spec.ts
- Create: packages/persistence/migrations/003_offers.ts

**Interfaces:**

~~~ts
interface SupplierAdapter {
  search(input: SearchRequest): Promise<OfferPage>;
  revalidate(input: RevalidateRequest): Promise<RevalidatedOffer>;
  createOrder(input: CreateSupplierOrder): Promise<CreateOrderResponse>;
  getOrder(input: SupplierOrderRef): Promise<SupplierOrderSnapshot>;
  cancel?(input: CancelSupplierOrder): Promise<CancelResult>;
  parseWebhook?(input: SupplierWebhook): Promise<SupplierOrderUpdate>;
}

interface SearchRequest {
  tripId: string;
  kind: OfferKind;
  origin?: string;
  destination: string;
  startsAt: string;
  endsAt?: string;
  travelers: number;
  budgetLimit?: Money;
}

interface OfferPage {
  offers: NormalizedOffer[];
  source: string;
  updatedAt: string;
  nextCursor?: string;
}

interface NormalizedOffer {
  id: string;
  kind: OfferKind;
  supplierId: string;
  title: string;
  price: Money;
  totalMinutes?: number;
  transferCount?: number;
  locationScore?: number;
  rating?: number;
  refundFlexibility?: number;
  refundSummary: string;
  source: string;
  updatedAt: string;
  snapshotHash: string;
}

interface RankedOffer extends NormalizedOffer {
  factorContributions: Record<string, number>;
  reasons: string[];
}

type RankingMode = 'value' | 'cheapest' | 'fastest' | 'comfortable';

function rankOffers(
  offers: ReadonlyArray<NormalizedOffer>,
  mode: RankingMode,
): RankedOffer[];
~~~

Every mock adapter accepts a deterministic fault mode: normal, expired_offer, inventory_lost, price_changed, delayed, create_indeterminate, duplicate_webhook, out_of_order_webhook, and prompt_injection_text.

- [ ] **Step 1: Write failing adapter contract tests**

For each category, assert search returns normalized IDs, CNY money, source, updatedAt, refund summary, and a stable snapshot hash. Assert that untrusted supplier text is retained as data and not interpreted as a tool instruction.

- [ ] **Step 2: Run adapter tests and verify failure**

Run: pnpm --filter @travel/supplier-adapters test

Expected: FAIL because adapters and fixtures are absent.

- [ ] **Step 3: Implement the adapter interface and fixtures**

Keep raw supplier payloads inside the adapter package. Convert them to contracts before leaving the adapter. Do not expose credentials or raw traveler fields in fixture data.

- [ ] **Step 4: Implement normalization and explainable ranking**

Use explicit factor values for price, total duration, transfers, location, rating, and refund flexibility. Return factor contributions and a human-readable reason list. Do not return an opaque AI score.

- [ ] **Step 5: Implement parallel search orchestration**

Use Promise.allSettled so one category can fail without hiding successful categories. Return per-category source, update time, warnings, and retryability.

- [ ] **Step 6: Expose the search endpoint**

Implement POST /v1/trips/{tripId}/searches. Validate the Trip owner and search request, enqueue long searches when needed, and return normalized offers plus category-level failures and source timestamps.

- [ ] **Step 7: Run tests and commit**

Run: pnpm --filter @travel/supplier-adapters test

Run: pnpm --filter @travel/application test -- search-service.test.ts

Run: pnpm --filter @travel/api test -- search.e2e-spec.ts

~~~text
git add packages/supplier-adapters packages/application/src/search packages/application/test/search-service.test.ts apps/api/src/modules/search apps/api/test/search.e2e-spec.ts packages/persistence/migrations/003_offers.ts
git commit -m "feat: add mock supplier search and ranking"
~~~

## Task 6: Implement Agent Runtime, Capability Gateway, and Planning API

**Files:**

- Create: packages/capability-gateway/src/context.ts
- Create: packages/capability-gateway/src/tool.ts
- Create: packages/capability-gateway/src/gateway.ts
- Create: packages/capability-gateway/src/policy-checker.ts
- Create: packages/capability-gateway/test/gateway.test.ts
- Create: packages/agent-runtime/src/llm-provider.ts
- Create: packages/agent-runtime/src/rule-based-provider.ts
- Create: packages/agent-runtime/src/agent-run.ts
- Create: packages/agent-runtime/src/tool-registry.ts
- Create: packages/agent-runtime/src/planning-orchestrator.ts
- Create: packages/agent-runtime/test/planning-orchestrator.test.ts
- Create: apps/api/src/modules/agent/agent.controller.ts
- Create: apps/api/src/modules/agent/agent.module.ts
- Create: apps/api/test/agent-planning.e2e-spec.ts
- Create: packages/persistence/migrations/004_agent_runs.ts
- Modify: packages/contracts/src/events.ts

**Interfaces:**

~~~ts
interface CapabilityContext {
  actorId: string;
  tripId: string;
  agentRunId: string;
  actionRequestId?: string;
  mandateId?: string;
  correlationId: string;
}

interface CapabilityTool<I, O> {
  name: string;
  risk: RiskLevel;
  inputSchema: ZodType<I>;
  execute(context: CapabilityContext, input: I): Promise<O>;
}

interface AgentContext {
  actorId?: string;
  tripId: string;
  agentRunId: string;
  userMessage: string;
  currentTripVersion: number;
  redactedOffers: NormalizedOffer[];
}

interface LlmProvider {
  generatePlan(input: AgentContext): Promise<StructuredAgentOutput>;
}

interface StructuredAgentOutput {
  assistantMessage: string;
  missingFields: string[];
  toolCalls: Array<{ toolName: string; input: unknown }>;
  actionRequests: Array<{ kind: string; resourceId: string }>;
}
~~~

- [ ] **Step 1: Write failing Gateway tests**

Assert that an unregistered tool is rejected, a commit tool cannot run with read-only context, a tool receives actor/trip/run context, and supplier text containing “ignore policy” never changes the policy result.

- [ ] **Step 2: Run Gateway tests and verify failure**

Run: pnpm --filter @travel/capability-gateway test

Expected: FAIL because the Gateway and policy checker do not exist.

- [ ] **Step 3: Implement the registry and policy checker**

Register only read and prepare planning tools in this task. Validate Zod input, risk level, actor ownership, Trip version, and correlation ID before execution. Return typed policy_blocked errors.

- [ ] **Step 4: Write failing Agent Runtime tests**

Give the rule-based provider a request missing dates and assert one minimal question. Give a complete request and assert four category search calls are emitted in parallel. Assert output contains source/update/risk summaries but no chain-of-thought field.

- [ ] **Step 5: Implement a deterministic local provider and resumable AgentRun**

The local provider parses a constrained request schema and delegates all actions to Gateway tools. Persist each tool call summary and next step through the application layer. Keep the LlmProvider boundary ready for a production model adapter without adding model-specific data access.

- [ ] **Step 6: Expose planning endpoints**

Implement POST /v1/agent/runs, GET /v1/agent/runs/{runId}, and POST /v1/agent/runs/{runId}/resume. Require anonymous planning context but reject any commit capability without an authenticated actor.

- [ ] **Step 7: Run tests and commit**

Run: pnpm --filter @travel/capability-gateway test

Run: pnpm --filter @travel/agent-runtime test

Run: pnpm --filter @travel/api test -- agent-planning.e2e-spec.ts

~~~text
git add packages/capability-gateway packages/agent-runtime apps/api/src/modules/agent apps/api/test/agent-planning.e2e-spec.ts packages/contracts/src/events.ts packages/persistence/migrations/004_agent_runs.ts
git commit -m "feat: add governed agent planning runtime"
~~~

## Task 7: Build the Anonymous Planning Web Workspace

**Files:**

- Create: apps/web/src/lib/api-client.ts
- Create: apps/web/src/lib/sse-client.ts
- Create: apps/web/src/features/trip/TripWorkspace.tsx
- Create: apps/web/src/features/agent/AgentActivityPanel.tsx
- Create: apps/web/src/features/search/OfferComparison.tsx
- Create: apps/web/src/features/itinerary/ItineraryList.tsx
- Create: apps/web/src/features/budget/BudgetSummary.tsx
- Create: apps/web/src/features/common/StatusBadge.tsx
- Create: apps/web/src/routes/PlannerRoute.tsx
- Create: apps/web/src/styles/tokens.css
- Create: apps/web/src/styles/app.css
- Create: apps/web/playwright.config.ts
- Create: apps/web/tests/planner.spec.ts
- Modify: apps/web/src/App.tsx

**Interfaces:**

- Consumes the planning API and the typed contracts package.
- Produces a desktop two-column workspace and a mobile stacked workflow.
- Displays Agent status, source/update time, risks, decisions required, ranking factors, budget thresholds, direct conflicts, and supplier mode.
- Does not store traveler plaintext or booking data in localStorage.
- Playwright starts the API in test mode and the Vite preview server through its webServer configuration; fixtures are reset before each test.

- [ ] **Step 1: Write the failing Playwright smoke test**

Navigate to the Web root, enter a domestic trip request, submit it, and assert that the page contains the trip workspace, Agent activity region, and at least one normalized offer card.

- [ ] **Step 2: Run the smoke test and verify failure**

Run: pnpm --filter @travel/web test:e2e -- planner.spec.ts

Expected: FAIL because routes and components do not exist.

- [ ] **Step 3: Implement the typed API and SSE clients**

Use fetch with credentials included, abortable requests, and a Last-Event-ID reconnect cursor. Normalize API errors into public AppError messages. Do not persist request bodies or event payloads containing traveler fields.

- [ ] **Step 4: Implement responsive workspace components**

Use semantic landmarks, keyboard focus states, stable dimensions for cards and controls, and a compact status language. On mobile expose the same information through stacked sections and bottom navigation; do not hide policy warnings behind hover-only interactions.

- [ ] **Step 5: Connect the planning form to the API**

Render missing-field questions as explicit form controls. Render partial category failures without removing successful categories. Render ranking factor contributions rather than a single unexplained score.

- [ ] **Step 6: Run browser tests at desktop and mobile widths**

Run: pnpm --filter @travel/web test:e2e -- planner.spec.ts

Run: pnpm --filter @travel/web lint

Expected: smoke flow passes at 1440x900 and 390x844 without horizontal overflow or overlapping status text.

- [ ] **Step 7: Commit the planning workspace**

~~~text
git add apps/web
git commit -m "feat: add responsive planning workspace"
~~~

## Task 8: Add Authentication, Vault Encryption, and TravelerDataGrant

**Files:**

- Create: packages/security/src/crypto.ts
- Create: packages/security/src/kms.ts
- Create: packages/security/src/redaction.ts
- Create: packages/security/test/crypto.test.ts
- Create: apps/vault/src/modules/vault/vault.service.ts
- Create: apps/vault/src/modules/vault/vault.controller.ts
- Create: apps/vault/src/modules/vault/vault.repository.ts
- Create: apps/vault/src/modules/grants/grant.service.ts
- Create: apps/vault/src/modules/grants/grant.controller.ts
- Create: apps/vault/test/vault.integration.test.ts
- Create: apps/api/src/modules/auth/identity-provider.ts
- Create: apps/api/src/modules/auth/dev-identity-provider.ts
- Create: apps/api/src/modules/auth/auth.guard.ts
- Create: apps/api/src/modules/auth/auth.module.ts
- Create: apps/api/src/modules/travelers/traveler.controller.ts
- Create: apps/api/src/modules/travelers/traveler.module.ts
- Create: packages/persistence/migrations/005_vault_refs.ts

**Interfaces:**

~~~ts
interface EnvelopeCrypto {
  encrypt(plaintext: Uint8Array, associatedData: string): Promise<EncryptedValue>;
  decrypt(value: EncryptedValue, associatedData: string): Promise<Uint8Array>;
}

interface EncryptedValue {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

interface GrantIssueInput {
  intentId: string;
  intentVersion: number;
  supplierLegalEntity: string;
  travelerIds: string[];
  allowedFields: string[];
  purpose: string;
  offerSnapshotHash: string;
  authorizationRef: string;
  expiresAt: string;
}

interface GrantRef {
  id: string;
  intentId: string;
  expiresAt: string;
}

interface AuthorizedTravelerFields {
  travelerId: string;
  fields: Record<string, string>;
}

interface LoginInput {
  developmentCode: string;
}

interface AuthenticatedActor {
  actorId: string;
  sessionId: string;
}

interface TravelerDataGrantService {
  issue(input: GrantIssueInput): Promise<GrantRef>;
  consumeOnce(ref: GrantRef, expectedIntentVersion: number): Promise<AuthorizedTravelerFields>;
  revoke(ref: GrantRef, reason: string): Promise<void>;
}

interface IdentityProvider {
  authenticate(input: LoginInput): Promise<AuthenticatedActor>;
  verifySession(session: string): Promise<AuthenticatedActor | null>;
}
~~~

- [ ] **Step 1: Write failing crypto and leak tests**

Assert that encrypt/decrypt round-trips with associated data, wrong associated data fails closed, ciphertext does not contain the plaintext bytes, and a test log/event serialization contains no traveler value.

- [ ] **Step 2: Run security tests and verify failure**

Run: pnpm --filter @travel/security test

Expected: FAIL because the crypto and redaction modules are absent.

- [ ] **Step 3: Implement local envelope encryption**

Use AES-256-GCM with a local development key provider loaded from an environment variable. Keep the KMS interface separate so production can replace the provider. Never log key material or decrypted values.

- [ ] **Step 4: Implement the isolated Vault schema and service**

Store encrypted field blobs, key version, field metadata, owner, retention, and deletion state in the Vault database/schema. Expose only field-specific operations. The API database stores TravelerVaultRef, not plaintext.

- [ ] **Step 5: Implement single-use Grant issuance and consumption**

Require intent ID/version, supplier legal entity, traveler IDs, allowed fields, purpose, offer snapshot hash, decision/mandate reference, five-minute expiry, and maxUses=1. Consume atomically and reject replay, expiry, version mismatch, supplier mismatch, or revoked grants.

- [ ] **Step 6: Add dev authentication and booking gate**

Provide a local-only identity provider for tests and development. Require AuthGuard for traveler, grant, mandate, action decision, and booking endpoints; keep anonymous planning endpoints available.

- [ ] **Step 7: Run integration and leak scans, then commit**

Run: pnpm --filter @travel/security test

Run: pnpm --filter @travel/vault test

Run: pnpm --filter @travel/api test -- travelers

Run: pnpm security:scan-sensitive-output

Expected: grant replay and expired grant are rejected; no fixture or captured payload contains traveler plaintext.

~~~text
git add packages/security apps/vault apps/api/src/modules/auth apps/api/src/modules/travelers packages/persistence/migrations/005_vault_refs.ts
git commit -m "feat: add traveler vault and scoped data grants"
~~~

## Task 9: Implement TravelMandate, ActionRequest, and Policy Decisions

**Files:**

- Create: packages/contracts/src/action-request.ts
- Create: packages/domain/src/mandate/mandate.ts
- Create: packages/domain/src/mandate/policy-evaluator.ts
- Create: packages/domain/test/mandate-policy.test.ts
- Create: packages/application/src/action-requests/action-request-service.ts
- Create: packages/application/test/action-request-service.test.ts
- Create: apps/api/src/modules/mandates/mandate.controller.ts
- Create: apps/api/src/modules/mandates/mandate.module.ts
- Create: apps/api/src/modules/action-requests/action-request.controller.ts
- Create: apps/api/src/modules/action-requests/action-request.module.ts
- Create: packages/persistence/migrations/006_mandates_actions.ts

**Interfaces:**

~~~ts
interface PolicyDecision {
  allowed: boolean;
  requiresFreshUserDecision: boolean;
  reasons: PolicyReason[];
  mandateVersion?: number;
}

interface ActionRequestInput {
  tripId: string;
  kind: 'booking' | 'traveler_data' | 'cancel' | 'refund' | 'budget_override';
  resourceId: string;
  risk: RiskLevel;
  requestedAmount?: Money;
}

interface CancelRequest {
  orderId: string;
  reason: string;
  expectedVersion: number;
}

interface RefundRequest {
  orderId: string;
  amount: Money;
  reason: string;
  expectedVersion: number;
}

interface ActionRequestView {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';
  kind: ActionRequestInput['kind'];
  resourceId: string;
  reasons: PolicyReason[];
  expiresAt: string;
}

function evaluateExecutionPolicy(
  action: ActionRequestInput,
  mandate: TravelMandate | null,
  current: PolicySnapshot,
): PolicyDecision;
~~~

- [ ] **Step 1: Write failing policy tests**

Cover default per-order confirmation, in-range Mandate authorization, over-budget block, supplier not allow-listed, non-refundable violation, expired/revoked Mandate, price change, and high-risk cancellation requiring a fresh decision.

- [ ] **Step 2: Run policy tests and verify failure**

Run: pnpm --filter @travel/domain test -- mandate-policy.test.ts

Expected: FAIL because Mandate and policy evaluator are absent.

- [ ] **Step 3: Implement immutable Mandate versions**

Persist each amendment as a new version with policy hash, actor, timestamp, validUntil, and revokedAt. Never update a previously used version in place.

- [ ] **Step 4: Implement ActionRequest lifecycle**

Use pending, approved, rejected, expired, and executed outcomes. Store the decision actor, decision reason, policy snapshot, request hash, and correlation ID. A decision may be consumed once for its bound command.

- [ ] **Step 5: Add API endpoints and Gateway integration**

Implement POST/GET Mandate, revoke, GET ActionRequest, and POST decision endpoints. Make Gateway call the evaluator immediately before any external side effect, even when an AgentRun previously received approval.

- [ ] **Step 6: Run tests and commit**

Run: pnpm --filter @travel/domain test -- mandate-policy.test.ts

Run: pnpm --filter @travel/application test -- action-request-service.test.ts

Run: pnpm --filter @travel/api test -- mandates

~~~text
git add packages/contracts/src/action-request.ts packages/domain/src/mandate packages/domain/test/mandate-policy.test.ts packages/application/src/action-requests packages/application/test/action-request-service.test.ts apps/api/src/modules/mandates apps/api/src/modules/action-requests packages/persistence/migrations/006_mandates_actions.ts
git commit -m "feat: add mandate and action decision policies"
~~~

## Task 10: Implement BookingIntent Commit, Mock Orders, and Redirects

**Files:**

- Create: packages/domain/src/booking/booking-intent.ts
- Create: packages/domain/src/booking/booking-state-machine.ts
- Create: packages/domain/test/booking-state-machine.test.ts
- Create: packages/application/src/booking/booking-service.ts
- Create: packages/application/src/booking/revalidation-service.ts
- Create: packages/application/test/booking-service.test.ts
- Create: packages/supplier-adapters/src/mock/mock-order-service.ts
- Create: packages/supplier-adapters/src/redirect/redirect-token.ts
- Create: packages/supplier-adapters/test/redirect-token.test.ts
- Create: apps/api/src/modules/bookings/booking.controller.ts
- Create: apps/api/src/modules/bookings/booking.module.ts
- Create: apps/api/test/booking.e2e-spec.ts
- Create: packages/persistence/migrations/007_bookings_orders.ts

**Interfaces:**

~~~ts
interface BookingService {
  commit(input: CommitBookingIntent): Promise<CommitBookingResult>;
  get(intentId: string, actorId: string): Promise<BookingIntentView>;
}

interface CommitBookingIntent {
  intentId: string;
  expectedVersion: number;
  actionRequestId?: string;
  mandateId?: string;
  idempotencyKey: string;
  selectedOfferSnapshotHash: string;
}

interface CommitBookingResult {
  intent: BookingIntentView;
  supplierOrder?: SupplierOrderSnapshot;
  redirectUrl?: string;
  requiresAction?: ActionRequestView;
}

interface BookingIntentView {
  id: string;
  version: number;
  status: BookingIntentStatus;
  revalidation?: RevalidationResult;
}

interface RevalidationResult {
  unchanged: boolean;
  currentOfferSnapshotHash: string;
  priceChanged: boolean;
  inventoryChanged: boolean;
  refundRulesChanged: boolean;
}

interface RedirectContext {
  intentId: string;
  supplierId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

interface RedirectTokenService {
  issue(input: RedirectContext, expiresAt: Date): Promise<string>;
  verify(token: string, now: Date): Promise<RedirectContext>;
}
~~~

CommitBookingIntent contains intentId, expectedVersion, actionRequestId, mandateId if applicable, idempotencyKey, and selectedOfferSnapshotHash. It never accepts traveler plaintext from the browser.

- [ ] **Step 1: Write failing state-machine tests**

Cover allowed transitions from draft through validation, grant wait, submission, supplier wait, completion/failure/expiry/cancel; reject skipping validation, committing twice, committing without a decision, and mutating a completed intent.

- [ ] **Step 2: Run state tests and verify failure**

Run: pnpm --filter @travel/domain test -- booking-state-machine.test.ts

Expected: FAIL because BookingIntent state functions are absent.

- [ ] **Step 3: Implement revalidation**

Load the immutable offer snapshot, call the adapter revalidate, compare price, inventory, and refund-rule hashes, then return a structured RevalidationResult. Any change produces RevalidationRequired and pauses commit.

- [ ] **Step 4: Implement transactional commit**

Within one database transaction, claim idempotency, verify actor/Trip ownership, version, ActionRequest/Mandate, budget, direct overlap, and grant reference. Append the state transition and Outbox task before returning.

- [ ] **Step 5: Implement Mock API order creation**

Map accepted/pending to awaiting_payment or awaiting_supplier, rejected to failed, and indeterminate to SupplierOrder creation_unknown. Save a distinct external idempotency key. Never retry indeterminate creation automatically.

- [ ] **Step 6: Implement signed redirect tokens**

Encode only intent ID, supplier ID, nonce, issuedAt, and expiry. Sign with a server key. Reject expired, replayed, wrong supplier, wrong actor, and altered tokens. No traveler field may appear in the token.

- [ ] **Step 7: Expose intent, commit, and order status APIs**

Implement POST /v1/trips/{tripId}/booking-intents, POST /v1/booking-intents/{intentId}/commit, and GET /v1/supplier-orders/{orderId}. Return 202 for unknown external outcomes and a public action requirement rather than a false success.

- [ ] **Step 8: Run tests and commit**

Run: pnpm --filter @travel/domain test -- booking-state-machine.test.ts

Run: pnpm --filter @travel/application test -- booking-service.test.ts

Run: pnpm --filter @travel/supplier-adapters test -- redirect-token.test.ts

Run: pnpm --filter @travel/api test -- bookings

~~~text
git add packages/domain/src/booking packages/domain/test/booking-state-machine.test.ts packages/application/src/booking packages/application/test/booking-service.test.ts packages/supplier-adapters/src/mock/mock-order-service.ts packages/supplier-adapters/src/redirect apps/api/src/modules/bookings apps/api/test/booking.e2e-spec.ts packages/persistence/migrations/007_bookings_orders.ts
git commit -m "feat: execute governed mock bookings"
~~~

## Task 11: Add Worker Tasks, Outbox/Inbox Delivery, Webhooks, Reconciliation, and SSE Replay

**Files:**

- Create: apps/worker/src/task-runner.ts
- Create: apps/worker/src/jobs/search-job.ts
- Create: apps/worker/src/jobs/booking-job.ts
- Create: apps/worker/src/jobs/supplier-poll-job.ts
- Create: apps/worker/src/jobs/reconciliation-job.ts
- Create: apps/worker/src/jobs/outbox-dispatch-job.ts
- Create: apps/worker/test/task-recovery.test.ts
- Create: apps/api/src/modules/webhooks/webhook.controller.ts
- Create: apps/api/src/modules/webhooks/webhook-verifier.ts
- Create: apps/api/test/webhook.e2e-spec.ts
- Create: apps/api/src/modules/events/event-stream.service.ts
- Create: apps/api/src/modules/events/event.controller.ts
- Create: apps/api/test/sse-replay.e2e-spec.ts
- Create: packages/application/src/reconciliation/reconciliation-service.ts
- Create: packages/application/test/reconciliation-service.test.ts
- Create: packages/persistence/migrations/008_webhooks_reconciliation.ts

**Interfaces:**

~~~ts
interface TaskHandler {
  kind: TaskKind;
  handle(task: TaskRecord): Promise<TaskOutcome>;
}

interface TaskRecord {
  id: string;
  kind: TaskKind;
  payload: unknown;
  attempts: number;
  leaseUntil?: string;
}

interface EventConsumerInbox {
  consumerName: string;
  eventId: string;
  processedAt: string;
}

interface WebhookVerifier {
  verify(headers: Record<string, string>, rawBody: Uint8Array): VerifiedWebhook;
}

interface VerifiedWebhook {
  supplierId: string;
  externalEventId: string;
  orderRef: SupplierOrderRef;
  payload: unknown;
}

type ReconciliationSource = 'webhook' | 'poll' | 'manual';

interface ReconciliationResult {
  orderId: string;
  status: ReconciliationStatus;
  lifecycleStatus: SupplierOrderLifecycle;
  reason?: string;
}

interface SupplierOrderView {
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

interface ReconciliationService {
  reconcile(orderId: string, source: ReconciliationSource): Promise<ReconciliationResult>;
}

interface EventStream {
  subscribe(tripId: string, lastEventId?: string): AsyncIterable<EventEnvelope>;
}
~~~

- [ ] **Step 1: Write failing task recovery tests**

Create a task, lease it, simulate a worker crash by advancing the test clock beyond leaseUntil, and assert another worker can reclaim it exactly once. Assert an Outbox event is not dispatched twice to the same Inbox consumer.

- [ ] **Step 2: Run recovery tests and verify failure**

Run: pnpm --filter @travel/worker test -- task-recovery.test.ts

Expected: FAIL because the task runner and handlers are absent.

- [ ] **Step 3: Implement the lease-based Worker**

Poll PostgreSQL tasks, lease with SKIP LOCKED, heartbeat long jobs, retry only retryable errors with exponential backoff, and move terminal failures to a visible dead-letter state. Keep each handler idempotent.

- [ ] **Step 4: Implement signed Webhook verification**

Verify supplier signature over the raw body and timestamp, reject stale timestamps and duplicate external event IDs, parse through the adapter, and enqueue a state update task. Do not trust a client-supplied order status.

- [ ] **Step 5: Implement reconciliation**

For creation_unknown, payment_unknown, paid-but-unconfirmed, and cancellation-unknown, query the supplier with bounded attempts. Map a matched snapshot to the lifecycle state; map disagreement to discrepancy/manual_review and emit ReconciliationRequired.

- [ ] **Step 6: Implement Outbox dispatch and event history**

Write event_log and outbox_events in the same transaction as aggregate changes. Dispatch redacted event envelopes through Inbox dedupe. Preserve per-aggregate sequence and expose historical replay.

- [ ] **Step 7: Implement SSE with Last-Event-ID**

Stream only events authorized for the actor and Trip. On reconnect, replay from the requested event ID, then follow new events. Never place traveler fields in the event payload.

- [ ] **Step 8: Run integration tests and commit**

Run: pnpm --filter @travel/worker test

Run: pnpm --filter @travel/api test -- webhook.e2e-spec.ts

Run: pnpm --filter @travel/api test -- sse-replay.e2e-spec.ts

Run: pnpm --filter @travel/application test -- reconciliation-service.test.ts

~~~text
git add apps/worker apps/api/src/modules/webhooks apps/api/src/modules/events apps/api/test packages/application/src/reconciliation packages/application/test/reconciliation-service.test.ts packages/persistence/migrations/008_webhooks_reconciliation.ts
git commit -m "feat: add recoverable booking workers and events"
~~~

## Task 12: Complete Orders, Budget Settlement, and After-Sales

**Files:**

- Create: packages/application/src/orders/order-query-service.ts
- Create: packages/application/src/orders/cancellation-service.ts
- Create: packages/application/src/orders/refund-service.ts
- Create: packages/application/test/orders-after-sales.test.ts
- Create: apps/api/src/modules/orders/order.controller.ts
- Create: apps/api/src/modules/orders/order.module.ts
- Create: apps/web/src/features/orders/OrderList.tsx
- Create: apps/web/src/features/orders/OrderDetail.tsx
- Create: apps/web/src/features/orders/AfterSalesAction.tsx
- Create: apps/web/src/features/action-center/ActionCenter.tsx
- Create: apps/web/tests/orders.spec.ts
- Create: packages/persistence/migrations/009_after_sales.ts
- Modify: packages/application/src/budget/budget-service.ts
- Modify: apps/web/src/features/budget/BudgetSummary.tsx

**Interfaces:**

~~~ts
interface OrderQueryService {
  listByTrip(tripId: string, actorId: string): Promise<SupplierOrderView[]>;
}

interface AfterSalesService {
  requestCancel(input: CancelRequest): Promise<ActionRequestView>;
  requestRefund(input: RefundRequest): Promise<ActionRequestView>;
}
~~~

- [ ] **Step 1: Write failing settlement and after-sales tests**

Assert paid transitions reserve/commit/paid ledger amounts exactly once, cancellation releases only the refundable amount after supplier confirmation, non-refundable cancellation requires a fresh decision, and partial-success Trips retain successful items.

- [ ] **Step 2: Run tests and verify failure**

Run: pnpm --filter @travel/application test -- orders-after-sales.test.ts

Expected: FAIL because order query and after-sales services are absent.

- [ ] **Step 3: Implement order projections**

Return lifecycle_status, reconciliation_status, supplier, payment location, ticket/reservation reference, refund rules, last update, and required user action. Redact supplier payloads to the fields needed by the UI.

- [ ] **Step 4: Implement cancellation and refund commands**

Create ActionRequest first, evaluate policy at execution time, call optional adapter cancel/refund operation, and persist unknown outcomes for reconciliation. Do not claim a refund before a verified supplier response.

- [ ] **Step 5: Build Action Center and order views**

Show approval, traveler authorization, revalidation, payment, reconciliation, and after-sales actions in one queue. Explain why an action is blocked and which data/price/rule changed.

- [ ] **Step 6: Run API and browser tests, then commit**

Run: pnpm --filter @travel/application test -- orders-after-sales.test.ts

Run: pnpm --filter @travel/api test -- orders

Run: pnpm --filter @travel/web test:e2e -- orders.spec.ts

~~~text
git add packages/application/src/orders packages/application/test/orders-after-sales.test.ts apps/api/src/modules/orders apps/web/src/features/orders apps/web/src/features/action-center apps/web/tests/orders.spec.ts packages/application/src/budget/budget-service.ts apps/web/src/features/budget/BudgetSummary.tsx packages/persistence/migrations/009_after_sales.ts
git commit -m "feat: add order tracking and after-sales flow"
~~~

## Task 13: Add Audit, Redacted Observability, Security Gates, and Operational Runbooks

**Files:**

- Create: packages/observability/src/logger.ts
- Create: packages/observability/src/metrics.ts
- Create: packages/observability/src/correlation.ts
- Create: packages/observability/test/redaction.test.ts
- Create: packages/security/src/http-security.ts
- Create: packages/security/src/webhook-replay.ts
- Create: packages/security/src/scan-sensitive-output.ts
- Create: packages/security/test/http-security.test.ts
- Create: packages/application/src/audit/audit-service.ts
- Create: packages/application/test/audit-service.test.ts
- Create: apps/api/src/modules/audit/audit.controller.ts
- Create: apps/api/src/modules/metrics/metrics.controller.ts
- Create: .github/workflows/ci.yml
- Create: docs/runbooks/local-development.md
- Create: docs/runbooks/incident-unknown-order.md
- Create: docs/runbooks/key-rotation-and-restore.md
- Create: docs/api/openapi.yaml
- Create: packages/persistence/migrations/010_audit.ts
- Modify: apps/api/src/main.ts
- Modify: apps/worker/src/main.ts
- Modify: apps/vault/src/main.ts

**Interfaces:**

~~~ts
interface AuditService {
  append(entry: AuditEntry): Promise<void>;
  listForTrip(tripId: string, actorId: string): Promise<AuditView[]>;
}

interface AuditEntry {
  actorId: string;
  action: string;
  resource: string;
  policyResult: string;
  reason?: string;
  mandateVersion?: number;
  grantRef?: string;
  requestId: string;
  correlationId: string;
  occurredAt: string;
}

interface AuditView extends AuditEntry {
  id: string;
  supplierId?: string;
  allowedFields?: string[];
}

interface LogEvent {
  name: string;
  requestId: string;
  correlationId: string;
  fields?: Record<string, unknown>;
}

interface RedactedLogger {
  info(event: LogEvent, fields?: Record<string, unknown>): void;
  warn(event: LogEvent, fields?: Record<string, unknown>): void;
  error(event: LogEvent, fields?: Record<string, unknown>): void;
}
~~~

- [ ] **Step 1: Write failing redaction and security tests**

Pass objects containing name, ID number, phone, payment references, Authorization headers, and encrypted blobs to the logger and HTTP error serializer. Assert none of those values appear in output. Assert stale webhook timestamps and duplicate signatures are rejected.

- [ ] **Step 2: Run security tests and verify failure**

Run: pnpm --filter @travel/observability test

Run: pnpm --filter @travel/security test

Expected: FAIL because redaction, correlation, and security modules are absent.

- [ ] **Step 3: Implement structured correlation and metrics**

Propagate request_id and correlation_id through AgentRun, ToolCall, ActionRequest, BookingIntent, SupplierOrder, Webhook, and Reconciliation. Add counters/histograms for latency, supplier errors, unknown orders, queue age, interventions, and model cost. Use stable IDs only.

- [ ] **Step 4: Implement append-only audit storage and query**

Write audit entries in the same transaction as policy-relevant state changes where possible. Expose user-readable views that identify actor, action, resource, supplier, allowed fields, policy result, and reason without exposing plaintext.

- [ ] **Step 5: Add HTTP and webhook hardening**

Configure secure cookie defaults, CSRF checks for browser mutations, CSP, request size limits, outbound supplier allowlists, SSRF rejection, timeout limits, raw-body signature verification, and replay windows.

- [ ] **Step 6: Add CI and runbooks**

CI must run install, typecheck, lint, unit tests, integration tests with PostgreSQL, Playwright smoke tests, dependency audit, and sensitive-output scan. Runbooks must document local startup, unknown-order response, key rotation, backup/PITR restore, and worker recovery.

- [ ] **Step 7: Run the complete quality gate and commit**

Run: pnpm typecheck

Run: pnpm lint

Run: pnpm test

Run: pnpm test:integration

Run: pnpm test:e2e

Run: pnpm security:scan-sensitive-output

~~~text
git add packages/observability packages/security packages/application/src/audit packages/application/test/audit-service.test.ts apps/api/src/modules/audit apps/api/src/modules/metrics .github docs/runbooks docs/api apps/api/src/main.ts apps/worker/src/main.ts apps/vault/src/main.ts packages/persistence/migrations/010_audit.ts
git commit -m "feat: add audit observability and security gates"
~~~

## Task 14: Release the Full Mock Workflow and Prepare Supplier Sandbox Rollout

**Files:**

- Create: apps/web/tests/full-trip-flow.spec.ts
- Create: apps/api/test/full-trip-flow.e2e-spec.ts
- Create: packages/testkit/src/scenarios/full-trip.ts
- Create: packages/testkit/src/scenarios/faults.ts
- Create: docs/runbooks/release-checklist.md
- Create: docs/runbooks/supplier-adapter-onboarding.md
- Modify: package.json
- Modify: .github/workflows/ci.yml

**Interfaces:**

- Produces one deterministic scenario that creates an anonymous Trip, completes four-category parallel search, selects offers, logs in, creates up to six traveler references, issues a Grant, creates a bounded Mandate, commits one API order and one redirect order, receives callbacks, reconciles an indeterminate order, and displays the resulting itinerary/budget/order views.
- Produces fault scenarios for offer expiration, inventory loss, price change, duplicate/out-of-order webhook, worker crash, SSE reconnect, Vault/KMS outage, Mandate revocation, and partial success.

- [ ] **Step 1: Write the failing full-flow scenario**

The scenario should assert the final domain state, not only visible text:

~~~ts
expect(trip.itinerary.confirmedItems).toHaveLength(2);
expect(trip.budget.paid.amountCents).toBe(expectedPaidCents);
expect(unknownOrder.reconciliation_status).toBe('pending');
expect(leakScan.matches).toHaveLength(0);
~~~

- [ ] **Step 2: Run the scenario and verify the first failure**

Run: pnpm --filter @travel/testkit test -- full-trip

Expected: FAIL until all prior slices are wired together.

- [ ] **Step 3: Wire the deterministic scenario through API, Worker, and Web**

Use fixture IDs and a frozen test clock. Run the same scenario once with normal adapters and once per fault mode. Ensure browser refresh and Worker restart happen mid-run in at least one case.

- [ ] **Step 4: Add release checklist gates**

The checklist must require zero duplicate supplier orders, zero sensitive-output scan matches, rejected invalid transitions, reconciled unknown orders, zero out-of-Mandate high-risk executions, successful restore drill, and reviewed supplier/legal data-flow documentation.

- [ ] **Step 5: Run the full release commands**

Run: pnpm ci

Run: pnpm --filter @travel/api test -- full-trip-flow.e2e-spec.ts

Run: pnpm --filter @travel/web test:e2e -- full-trip-flow.spec.ts

Expected: all checks pass with PostgreSQL and the Mock Supplier stack running.

- [ ] **Step 6: Commit the release slice**

~~~text
git add apps/web/tests/full-trip-flow.spec.ts apps/api/test/full-trip-flow.e2e-spec.ts packages/testkit docs/runbooks/release-checklist.md docs/runbooks/supplier-adapter-onboarding.md package.json .github/workflows/ci.yml
git commit -m "test: verify complete mock travel workflow"
~~~

## Execution Order and Review Gates

Execute tasks in numeric order. After Tasks 1, 3, 6, 8, 10, 11, and 14, stop for a focused review because each introduces a boundary that can affect privacy, external side effects, or recovery:

1. Task 1 proves the workspace starts.
2. Task 3 proves persistence, versioning, and idempotency.
3. Task 6 proves the Agent cannot bypass the Gateway.
4. Task 8 proves traveler plaintext stays in the Vault boundary.
5. Task 10 proves commit and unknown-order semantics.
6. Task 11 proves crash/retry/replay recovery.
7. Task 14 proves the full user-visible workflow.

Do not add a real supplier before Task 14 passes with Mock/Sandbox. Onboarding a real supplier is a separate adapter change that must pass the adapter contract, security review, data-flow review, sandbox tests, and a one-category gray rollout.

## Spec Coverage Self-Review

- Product scope, anonymous planning, four categories, ranking, budget, time, restaurant fallback, collaboration limit: Tasks 4, 5, 6, 7, and 14.
- Capability Gateway, deterministic domain rules, Agent visibility, and future provider boundary: Task 6.
- Traveler Vault, field encryption, Grant binding, authentication, and redaction: Task 8 and Task 13.
- TravelMandate, default confirmation, ActionRequest, and high-risk exceptions: Task 9.
- BookingIntent, SupplierOrder lifecycle, revalidation, idempotency, redirect, payment boundary: Task 10.
- Worker lease, Outbox/Inbox, callbacks, reconciliation, SSE recovery: Task 11.
- Budget settlement, cancellation/refund, partial success, and action center: Task 12.
- Observability, audit, security, CI, runbooks, and release gates: Tasks 13 and 14.
- Modular-monolith deployment and future mobile reuse: Tasks 1, 3, 7, 11, and 13.

The plan contains no unresolved task placeholders. Any change to a frozen invariant must be proposed as a spec revision before changing the corresponding implementation task.
