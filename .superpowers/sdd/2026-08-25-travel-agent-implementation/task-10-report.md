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
