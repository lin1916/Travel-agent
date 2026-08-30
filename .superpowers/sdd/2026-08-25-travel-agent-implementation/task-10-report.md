# Task 10 Implementation Report

## Changes

- Added BookingIntent aggregate and explicit state-machine transitions with optimistic version increments.
- Added revalidation result comparison for offer hash, price, inventory, and refund-rule hash.
- Added in-memory BookingService commit flow using grant references only, action idempotency, external idempotency keys, and safe supplier outcome mapping.
- Added MockOrderService: accepted/pending map to awaiting_payment, rejected to failed, and indeterminate to creation_unknown/manual_review without automatic retry.
- Added signed HMAC redirect token service containing only intentId, supplierId, nonce, issuedAt, and expiresAt; altered, expired, and replayed tokens are rejected.
- Added forward PostgreSQL migration `009_bookings_orders`, database types, and migration runner registration.
- Added Nest booking-intent create/get/commit routes and module wiring.

## TDD RED/GREEN

RED: `pnpm --filter @travel/domain test -- booking-state-machine.test.ts` and `pnpm --filter @travel/supplier-adapters test -- redirect-token.test.ts` failed because the requested implementation modules were absent.

GREEN: domain booking tests passed 25/25, supplier adapter tests passed 17/17, and application booking tests passed 18/18.

## Verification

- `pnpm --filter @travel/domain test -- booking-state-machine.test.ts` — 6 files, 25 tests passed.
- `pnpm --filter @travel/application test -- booking-service.test.ts` — 4 files, 18 tests passed.
- `pnpm --filter @travel/supplier-adapters test -- redirect-token.test.ts` — 2 files, 17 tests passed.
- `pnpm --filter @travel/api test -- bookings` — 6 files, 25 tests passed.
- `pnpm typecheck` — 13 tasks successful.
- `pnpm lint` — 13 tasks successful.
- `pnpm build` — completed successfully.

## Remaining risks

- Booking persistence repository and production wiring remain in-memory for this task's API path; PostgreSQL schema and migration are present, but a production repository adapter should be added before enabling live booking execution.
- API route payload validation and full Gateway evaluator wiring need integration with the existing ActionRequest/Mandate providers before production exposure.

## Fix Round 1

- Added resumable commit path from `awaiting_user_decision` after a fresh authorization reference.
- Commit now requires `actionRequestId` or `mandateId`, binds to the immutable stored offer hash, and never uses a browser hash for supplier calls.
- Rejected supplier creation transitions the BookingIntent to `failed`; unknown creation remains `creation_unknown`/manual review.
- Added strict booking create/commit DTO schemas, traveler/extra-field rejection, actor ownership checks, order lookup, and 202 unknown-order behavior.
- Redirect token issue now allowlists the five required fields and stores actor binding out-of-band for verification; supplier and actor mismatches are rejected.
- Production API booking provider fails closed when `DATABASE_URL` is missing.
- Added `apps/api/test/booking.e2e-spec.ts` coverage for strict payloads, authorization, and booking routes.

Fix-round verification:

- `pnpm --filter @travel/application test -- booking-service.test.ts` — 4 files, 20 tests passed.
- `pnpm --filter @travel/supplier-adapters test -- redirect-token.test.ts` — 2 files, 18 tests passed.
- `pnpm --filter @travel/api test -- bookings` — 7 files, 27 tests passed.
- `pnpm --filter @travel/domain test -- booking-state-machine.test.ts` — 6 files, 25 tests passed.

Remaining concerns: durable PostgreSQL booking/order repositories and full evaluator/outbox integration remain follow-up work; production execution is fail-closed without `DATABASE_URL`.

## Fix Round 2

- Added explicit `BookingAuthorization` lookup/consume dependency; commits fail closed when authorization lookup is unavailable and consume the authorization before supplier creation.
- Enforced actor ownership on supplier-order lookup and made redirect actor binding mandatory at token issuance.
- Added regression coverage for unavailable authorization and mandatory redirect actor binding.
- Production booking module now refuses to start without a durable PostgreSQL booking repository implementation, preventing process-local Maps from becoming production business truth.

Fix-round 2 verification:

- `pnpm --filter @travel/application test -- booking-service.test.ts` — 4 files, 21 tests passed.
- `pnpm --filter @travel/supplier-adapters test -- redirect-token.test.ts` — 2 files, 18 tests passed.
- `pnpm --filter @travel/api test -- bookings` — 7 files, 27 tests passed.
- `pnpm typecheck` — 13 tasks successful.
- `pnpm lint` — 13 tasks successful.
- `pnpm build` — completed successfully.

Remaining concern: a real PostgreSQL BookingIntent/SupplierOrder repository with transaction/outbox integration remains required before enabling non-test booking execution; the API now fails closed until that adapter exists.

## Fix Round 3

- Added `ActionRequestBookingAuthorization`, which loads the current action record, validates actor ownership, trip, offer resource, booking/commit binding, approval and expiry, then performs the command-bound one-use consume.
- Expanded API booking coverage with an authorized commit, supplier-order status read, and owner denial.
- Test-only API wiring supplies an explicit isolated authorization double; non-test execution remains fail-closed pending durable repository/provider wiring.

Fix-round 3 verification:

- `pnpm --filter @travel/application test -- booking-service.test.ts` — 4 files, 22 tests passed.
- `pnpm --filter @travel/supplier-adapters test -- redirect-token.test.ts` — 2 files, 18 tests passed.
- `pnpm --filter @travel/api test -- booking.e2e-spec.ts` — 7 files, 27 tests passed.

Remaining concern: a production-grade BookingAuthorization must additionally connect the current mandate evaluator, budget/overlap projections, grant store, audit, and transactional durable BookingIntent/SupplierOrder/outbox repositories. Production booking execution remains disabled until that provider is implemented.

## Fix Round 4

- Added `GovernedBookingAuthorization`, which requires a current approved ActionRequest and current TravelMandate, re-evaluates the immutable command against fresh budget/offer facts, rejects direct itinerary overlap, and fails closed for missing/expired/revoked/mismatched authorization.
- Added explicit traveler-grant lookup and command binding (intent/version, supplier legal entity, travelers, fields, purpose, offer snapshot, authorization reference), with one-use consumption in the same authorization transaction boundary. Audit and outbox intents are appended from redacted payloads only.
- Added PostgreSQL `BookingRepository` using migration `009_bookings_orders`, optimistic version CAS, durable commit idempotency via the existing `idempotency_keys` table, supplier-order persistence, owner lookup through the intent join, transactional intent/order/outbox persistence, and append-only migration coverage. Production API wiring remains explicitly fail-closed until a durable repository and grant provider are configured; tests use an isolated governed fixture rather than a permissive fake.
- Redirect tokens now derive the signature key from the actor identity, require actor and supplier bindings at verification, enforce exactly the five allowed fields, and use a nonce store for replay checks. Booking commits issue actor/supplier-bound redirect URLs for supplier payment pages.
- Expanded booking API e2e coverage for accepted/payment, rejected, indeterminate/202, order ownership denial, and pause/resume after revalidation with fresh ActionRequest/Mandate/grant bindings.

Fix-round 4 verification:

- `pnpm --filter @travel/domain test -- booking-state-machine.test.ts` — 6 files, 25 tests passed.
- `pnpm --filter @travel/application test -- booking-service.test.ts` — 4 files, 24 tests passed.
- `pnpm --filter @travel/supplier-adapters test -- redirect-token.test.ts` — 2 files, 18 tests passed.
- `pnpm --filter @travel/api test -- booking.e2e-spec.ts` — 7 files, 30 tests passed.
- `pnpm --filter @travel/persistence test -- migrations.test.ts` — 4 files passed, 3 PostgreSQL integration files skipped because `DATABASE_URL` is unset (8 passed, 7 skipped).
- `pnpm --filter @travel/application typecheck` — passed.
- `pnpm --filter @travel/persistence typecheck` — passed.

Remaining concerns: PostgreSQL execution and locking remain unverified without `DATABASE_URL`; production booking remains intentionally unavailable until the durable repository, fresh-facts provider, and vault grant-consume client are configured. The mock supplier remains test-only and no plaintext traveler data is accepted or persisted.

## Fix Round 5

- Moved durable commit-idempotency claims until after offer revalidation and governed authorization succeed, so denied or paused requests do not leave an in-flight claim.
- Added PostgreSQL booking-repository integration coverage for intent CAS, idempotency replay/conflict, transactional intent/order/outbox/response persistence, and per-aggregate outbox sequence allocation. Outbox sequence allocation now uses a transaction-scoped PostgreSQL advisory lock plus `MAX(sequence) + 1`.
- Added `GET /v1/supplier-redirects/:supplierId?token=...`, which verifies the actor and supplier binding before returning the stored supplier payment URL.

Fix-round verification:

- `pnpm --filter @travel/domain test -- booking-state-machine.test.ts` — 6 files, 25 tests passed.
- `pnpm --filter @travel/application test -- booking-service.test.ts` — 4 files, 25 tests passed.
- `pnpm --filter @travel/supplier-adapters test -- redirect-token.test.ts` — 2 files, 18 tests passed.
- `pnpm --filter @travel/api test -- booking.e2e-spec.ts` — 7 files, 30 tests passed.
- `pnpm --filter @travel/persistence test` — 4 files passed, 4 PostgreSQL integration files skipped (8 passed, 10 skipped) because `DATABASE_URL` is unset.
- `pnpm typecheck` — 13 tasks successful.
- `pnpm lint` — 13 tasks successful.
- `pnpm build` — 13 tasks successful.
- `pnpm test` — 13 tasks successful; package tests passed with only Turbo output-cache warnings.

Remaining concerns: PostgreSQL booking-repository integration and locking are not exercised in this environment without `DATABASE_URL`; production booking remains intentionally fail-closed until the durable repository, current-facts provider, and vault grant-consume client are configured. Redirect replay storage defaults to an in-memory nonce store and should use a durable nonce adapter for multi-instance production deployment.
