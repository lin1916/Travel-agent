# Task 11 report — Worker tasks, delivery, webhooks, reconciliation, and SSE replay

Date: 2026-08-30
Base: `ad7e624`

## Implemented behavior

- Added lease-based worker execution with PostgreSQL-compatible task-store contracts, owner-qualified heartbeat/retry/completion, lease expiry reclaim, exponential retry backoff, explicit retry ceilings, and visible dead-letter outcomes.
- Added worker jobs for search persistence, booking execution injection, supplier polling, reconciliation, webhook updates, and outbox dispatch. Search results are persisted idempotently in `offers` and emit a redacted `SearchCompleted` event.
- Added Inbox claim/release semantics. Outbox dispatch is deduplicated per consumer; failed delivery releases only that claim so a later attempt can retry.
- Added HMAC webhook verification over the exact raw body plus timestamp, constant-time signature comparison, stale timestamp rejection, external-event identity checks, adapter parsing, duplicate-event rejection, and deterministic reference-only `webhook_update` tasks.
- Added reconciliation for creation/payment/cancellation unknown states, bounded supplier attempts, matched snapshots, discrepancy/manual-review handling, and redacted `SupplierOrderReconciled` / `ReconciliationRequired` events. Unknown or contradictory supplier results never become success.
- Added forward-only migration `010_webhooks_reconciliation` for webhook receipts, Trip-scoped event/outbox fields, supplier-order reconciliation fields, indexes, and legacy outbox-to-event-history backfill.
- Added ordered event history with per-aggregate sequence allocation, global stream positions, Trip ownership authorization, `Last-Event-ID` replay, live polling follow-up, and SSE controller output limited to validated/redacted `EventEnvelope` fields.
- Added durable payload guards rejecting traveler plaintext, raw body, payment-card, identity, and similar sensitive keys before task/event/offer serialization.
- Kept non-test API/worker paths fail-closed when required PostgreSQL or webhook-secret providers are unavailable.

## Files changed

- Worker: `apps/worker/src/task-runner.ts`, `apps/worker/src/jobs/*.ts`, `apps/worker/src/main.ts`, `apps/worker/test/task-recovery.test.ts`, `apps/worker/package.json`
- API: webhook and event modules/controllers/services, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/modules/search/search.module.ts`, `apps/api/test/webhook.e2e-spec.ts`, `apps/api/test/sse-replay.e2e-spec.ts`
- Application: reconciliation service and tests, exports
- Contracts: cancellation-unknown lifecycle and contract test
- Persistence: migration `010_webhooks_reconciliation.ts`, task/outbox/inbox/event/booking/webhook/offer repositories, types, migration registration, integration/unit tests
- Existing `progress.md` was preserved and not staged.

## RED and GREEN evidence

- Worker RED: `pnpm --filter @travel/worker test -- task-recovery.test.ts` failed with missing `outbox-dispatch-job.js` / `task-runner.js`; GREEN: 6 tests passed.
- Persistence RED: migration/payload tests failed because `010_webhooks_reconciliation` and `assertDurablePayloadSafe` were absent; GREEN: persistence unit/migration tests passed.
- Webhook RED: `pnpm --filter @travel/api test -- webhook.e2e-spec.ts` failed with missing webhook modules; GREEN: 3 webhook tests plus API suite passed.
- Reconciliation RED: `pnpm --filter @travel/application test -- reconciliation-service.test.ts` failed with missing service; GREEN: 3 reconciliation tests plus application suite passed.
- SSE RED: `pnpm --filter @travel/api test -- sse-replay.e2e-spec.ts` failed with missing event-stream service; GREEN: 3 SSE tests plus API suite passed.
- Additional RED/GREEN cycles covered explicit retry ceiling, Inbox claim release on failed delivery, legacy outbox conversion, sensitive raw-body rejection, and idempotent search persistence.

## Focused verification

- `pnpm --filter @travel/worker test` — 1 file, 6 passed.
- `pnpm --filter @travel/api test -- webhook.e2e-spec.ts` — 9 files, 36 passed.
- `pnpm --filter @travel/api test -- sse-replay.e2e-spec.ts` — 9 files, 36 passed.
- `pnpm --filter @travel/application test -- reconciliation-service.test.ts` — 5 files, 32 passed.
- `pnpm --filter @travel/persistence test` — 10 passed, 16 skipped in four existing PostgreSQL suites plus 1 new PostgreSQL webhook suite skipped.
- `pnpm typecheck` — 13 successful tasks.
- `pnpm lint` — 13 successful tasks.
- `pnpm security:scan-sensitive-output` — no production traveler-sensitive matches introduced.
- `pnpm test` — 13 successful packages; all available tests passed.

## PostgreSQL execution / skip status

`DATABASE_URL` was not set in this environment. PostgreSQL integration suites compiled and were conditionally skipped by their existing `describe.skip` pattern. No runtime PostgreSQL verification is claimed.

## Self-review

- Confirmed `git diff --check` is clean.
- Confirmed migration history remains forward-only; migrations `001`–`009` were not edited.
- Confirmed no process-local business Maps were added to production persistence paths.
- Confirmed webhook tasks contain supplier/order references only, never raw body or supplier status.
- Confirmed stale worker owners cannot heartbeat/retry/complete after lease expiry or reclaim.
- Confirmed event replay authorizes actor + Trip and validates/redacts envelopes before emission.

## Concerns

- Live SSE follow-up uses bounded PostgreSQL polling rather than a push broker, as required for V1; production tuning may adjust the poll interval.
- Runtime PostgreSQL behavior remains unverified until a reachable `DATABASE_URL` is supplied.
- Existing test-only in-memory booking/search providers remain in test composition roots; production paths fail closed where durable providers are required.

## Fix Round 1

Addressed review findings with focused RED/GREEN regressions:

- Registered `BookingJob` through `createWorkerHandlers`; production composition now injects an explicit fail-closed booking executor instead of leaving booking tasks without a handler.
- Replaced permanent Inbox claims with recoverable delivery leases and explicit completion. Forward-only migration `011_inbox_delivery_claims` adds claim owner/expiry and delivered state. Outbox events are marked published only after delivery and Inbox completion; busy claims retry, failed delivery releases, and expired claims can be reclaimed.
- `SearchJob` now returns a retry outcome when any completed search category is retryable and does not persist partial offers.
- Webhook acceptance resolves the supplier reference to the local `supplier_orders.id`; reconciliation tasks require that local `orderId` and no longer fall back to supplier IDs. Unmapped references fail closed for manual review.
- API bootstrap now applies all migrations before Nest repositories are constructed. The production event-stream handoff is explicit fail-closed rather than a no-op consumer.

RED/GREEN evidence:

- RED: updated worker/persistence tests initially failed to compile against the old Inbox boolean/permanent-claim API; GREEN after migration/repository/job redesign: `pnpm --filter @travel/worker exec vitest run test/task-recovery.test.ts --reporter=dot` — 10 passed.
- GREEN: `pnpm --filter @travel/api exec vitest run test/webhook.e2e-spec.ts --reporter=dot` — 3 passed.
- GREEN: `pnpm --filter @travel/application exec vitest run test/reconciliation-service.test.ts --reporter=dot` — 3 passed.
- GREEN: `pnpm --filter @travel/persistence exec vitest run --reporter=dot` — 10 passed, 18 skipped because `DATABASE_URL` is unset.
- GREEN: `pnpm typecheck` — 13 successful tasks.

The PostgreSQL integration tests compile but remain runtime-skipped in this environment because `DATABASE_URL` is not set.

## Fix Round 2

Addressed the scoped re-review blockers:

- Strengthened `assertDurablePayloadSafe` with traveler-context enforcement. Unknown nested fields under traveler/passenger/guest/customer objects are rejected as traveler plaintext, while vault references, grant IDs, allowed field names, purposes, and other binding metadata remain permitted.
- Fixed the Inbox external-event insert-conflict path to retain and update the raced row’s actual `event_id`, allowing expired claims keyed by `externalEventId` to be reclaimed safely.
- Made `WebhookRepository.accept` resolve the local order through the transaction handle (`tx`), keeping order lookup, receipt insertion, and task insertion in one transaction boundary.

RED/GREEN evidence:

- RED: `pnpm --filter @travel/persistence exec vitest run test/persistence-unit.test.ts --reporter=dot` — 3 new regressions failed: arbitrary nested traveler plaintext was accepted, the raced external-event claim returned `busy`, and webhook lookup escaped the transaction.
- GREEN: same command — 9 tests passed.
- GREEN: `pnpm --filter @travel/persistence test` — 13 passed, 18 skipped because `DATABASE_URL` is unset.
- GREEN: `pnpm --filter @travel/worker test` — 10 passed.
- GREEN: `pnpm --filter @travel/api exec vitest run test/webhook.e2e-spec.ts test/sse-replay.e2e-spec.ts --reporter=dot` — 6 passed.
- GREEN: `pnpm typecheck` — 13 successful tasks.
- GREEN: `pnpm lint` — 13 successful tasks.

PostgreSQL integration behavior remains runtime-unverified in this environment because `DATABASE_URL` is not set.

## Fix Round 3

Closed the remaining traveler-metadata payload gap with an explicit reference envelope:

- `travelerRef` and `travelerVaultRef` values must be opaque identifiers: UUIDs or bounded, whitespace-free identifiers using approved reference prefixes.
- A nested `traveler`/`passenger`/`guest`/`customer` object must include an opaque reference and may contain only `travelerRef`, `travelerVaultRef`, `travelerIds`, `allowedFields`, and `purpose`.
- `travelerIds` and `allowedFields` are non-empty arrays capped at 16 entries. Field names are limited to the vault’s defined traveler fields.
- `purpose` is limited to `ticketing`, `booking`, `reservation`, `supplier_fulfillment`, or `traveler_verification`.
- Existing top-level redacted references remain accepted with the same reference, field-list, and purpose validation.

RED/GREEN evidence:

- RED: `pnpm --filter @travel/persistence exec vitest run test/persistence-unit.test.ts --reporter=dot` — the new regression failed because `{ traveler: { purpose: 'Alice Lovelace' } }` and plaintext reference values were accepted. A second RED check proved top-level plaintext purpose could also accompany a valid reference.
- GREEN: same command — 10 tests passed.
- GREEN: `pnpm --filter @travel/persistence test` — 14 passed, 18 skipped because `DATABASE_URL` is unset.
- GREEN: `pnpm --filter @travel/worker test` — 10 passed.
- GREEN: `pnpm --filter @travel/api exec vitest run test/webhook.e2e-spec.ts test/sse-replay.e2e-spec.ts --reporter=dot` — 6 passed.
- GREEN: `pnpm typecheck` — 13 successful tasks.
- GREEN: `pnpm lint` — 13 successful tasks.

PostgreSQL integration behavior remains runtime-unverified because `DATABASE_URL` is not set.

## Fix Round 3 value-schema follow-up

Closed the remaining durable traveler-payload gap with strict value validation:

- Traveler references must be UUIDs or bounded opaque identifiers with approved reference prefixes; human-readable names are rejected.
- Traveler-bound envelopes permit only `travelerRef`/`travelerVaultRef`, bounded `travelerIds`, the vault-defined `allowedFields`, and approved purpose values (`ticketing`, `booking`, `reservation`, `supplier_fulfillment`, `traveler_verification`).
- Plaintext disguised as `purpose`, `travelerVaultRef`, `grantId`, `authorizationRef`, `travelerIds`, or `travelerCount` is rejected. Valid opaque grant/authorization refs, bounded traveler IDs/count, top-level redacted references, and nested reference envelopes remain accepted.

RED/GREEN evidence:

- RED: `pnpm --filter @travel/persistence exec vitest run test/persistence-unit.test.ts --reporter=dot` — the new regressions failed because plaintext purpose/reference values and safe-looking grant/authorization/traveler metadata values were accepted.
- GREEN: same command — 10 tests passed.
- GREEN: `pnpm --filter @travel/persistence test` — 14 passed, 18 skipped because `DATABASE_URL` is unset.
- GREEN: `pnpm --filter @travel/worker test` — 10 passed.
- GREEN: `pnpm --filter @travel/api exec vitest run test/webhook.e2e-spec.ts test/sse-replay.e2e-spec.ts --reporter=dot` — 6 passed.
- GREEN: `pnpm typecheck` — 13 successful tasks.
- GREEN: `pnpm lint` — 13 successful tasks.

PostgreSQL integration behavior remains runtime-unverified because `DATABASE_URL` is not set.

## Fix Round 4

Closed the remaining durable payload privacy blocker with an explicit opaque-reference shape and nested traveler ID validation:

- Opaque traveler references are UUIDs or bounded (1–128 chars) approved-prefix identifiers made of lowercase technical labels ending in a numeric token; human-readable values such as `vault-ref-Alice-Lovelace` and `traveler-Jane-Doe` are rejected.
- Nested traveler reference envelopes now reject non-array, empty/overlong, and non-opaque `travelerIds` values while preserving valid redacted references, field metadata, purpose, and traveler counts.

RED/GREEN evidence:

- RED: `pnpm --filter @travel/persistence exec vitest run test/persistence-unit.test.ts --reporter=dot` — 1 regression failed (10 passed) because nested human-readable traveler references were accepted.
- GREEN: `pnpm --filter @travel/persistence exec vitest run test/persistence-unit.test.ts --reporter=dot` — 11 tests passed.
- GREEN: `pnpm --filter @travel/persistence test` — 15 passed, 18 skipped because `DATABASE_URL` is unset.
- GREEN: `pnpm --filter @travel/worker test` — 10 passed.
- GREEN: `pnpm --filter @travel/api exec vitest run test/webhook.e2e-spec.ts test/sse-replay.e2e-spec.ts --reporter=dot` — 6 passed.
- GREEN: `pnpm --filter @travel/application exec vitest run test/reconciliation-service.test.ts --reporter=dot` — 3 passed.
- GREEN: `pnpm typecheck` — 13 successful tasks.
- GREEN: `pnpm lint` — 13 successful tasks.

PostgreSQL integration behavior remains runtime-unverified because `DATABASE_URL` is not set.

## Fix Round 5

Closed the final durable traveler-reference gap by requiring UUIDs or high-entropy opaque tokens:

- Approved-prefix references now require a single 16–128-character lowercase alphanumeric token containing both letters and digits; short IDs and human-readable labels such as `traveler-jane-1` and `vault-ref-alice-1` are rejected.
- UUID references remain accepted.
- Existing persistence fixtures that asserted accepted short references were updated to deterministic high-entropy tokens; no traveler plaintext is admitted into durable payloads.

RED/GREEN evidence:

- RED: `pnpm --filter @travel/persistence exec vitest run test/persistence-unit.test.ts --reporter=dot` — 1 failed, 11 passed; the new regression showed `traveler-jane-1` was accepted.
- GREEN: `pnpm --filter @travel/persistence exec vitest run test/persistence-unit.test.ts --reporter=dot` — 1 file, 12 passed.
- GREEN: `pnpm --filter @travel/persistence test` — 4 files, 16 passed; 5 PostgreSQL files, 18 tests skipped because `DATABASE_URL` is unset.
- GREEN: `pnpm --filter @travel/worker test` — 1 file, 10 passed.
- GREEN: `pnpm --filter @travel/api exec vitest run test/webhook.e2e-spec.ts --reporter=dot` — 1 file, 3 passed.
- GREEN: `pnpm --filter @travel/api exec vitest run test/sse-replay.e2e-spec.ts --reporter=dot` — 1 file, 3 passed.
- GREEN: `pnpm --filter @travel/application exec vitest run test/reconciliation-service.test.ts --reporter=dot` — 1 file, 3 passed.
- GREEN: `pnpm typecheck` — 13 successful tasks.
- GREEN: `pnpm lint` — 13 successful tasks.

PostgreSQL integration behavior remains runtime-unverified because `DATABASE_URL` is not set.
