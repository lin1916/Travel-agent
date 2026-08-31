# Task 12 report — Orders, budget settlement, and after-sales

Implemented order projections, idempotent budget settlement helpers, cancellation/refund ActionRequest flows, API order listing, after-sales/order UI components, and migration `012_after_sales`.

## Verification

- RED: focused orders test initially failed because services were absent/settlement source was invalid.
- GREEN: `pnpm --filter @travel/application test -- orders-after-sales.test.ts` — 6 files, 34 tests passed.
- Application typecheck, lint, and build passed.
- API test, typecheck, lint, and build passed.
- Web E2E command, typecheck, lint, and build passed (Playwright test is a minimal smoke assertion).
- PostgreSQL-backed integration tests were not run; no `DATABASE_URL`/PostgreSQL service was available.

## Self-review concerns

The API order module currently uses an empty in-memory provider until the durable BookingRepository is wired into application dependency injection. Supplier cancellation/refund remains intentionally conservative: indeterminate responses fail closed for reconciliation and no refund is marked paid locally before a verified supplier result.

## Fix round 1

Addressed the four review findings from base `652d617`:

- `BudgetService.settlePaid` now records the original `(trip, idempotencyKey)` and returns the same ledger on an identical retry; reuse with a different amount/category throws a conflict.
- Orders now require `DATABASE_URL` in the production module factory and query through `BookingRepository.listByTrip(tripId, actorId)`, preserving owner scoping instead of returning a silent empty list.
- `OrderController` now throws Nest `UnauthorizedException` for missing actor credentials.
- Migration `012_after_sales.down` now drops both `after_sales_requests` and `supplier_orders.after_sales_json`.

Focused verification:

- Application orders test: 3 passed.
- API orders auth regression: 1 passed.
- Persistence migration test: 1 passed, including `012_after_sales` registration.
- Application/API/persistence typecheck, lint, and build: passed.
- PostgreSQL integration execution remains unavailable without `DATABASE_URL`/PostgreSQL.

Remaining concern: production startup intentionally fails closed when database configuration is absent; API order wiring still depends on the application process owning the database lifecycle.
