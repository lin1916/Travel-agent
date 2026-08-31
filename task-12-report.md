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
