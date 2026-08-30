# Task 9 report — TravelMandate, ActionRequest, and policy decisions

## Implementation

- Extended `ActionRequestInput` with optional execution facts (supplier, booking type, refundability, offer snapshot, sensitive fields) while preserving the Task 2 shape.
- Added append-only `MandateStore` with owner-bound create/amend/revoke, immutable versions, timestamps, actor metadata, and policy hashes.
- Added deterministic `evaluateExecutionPolicy` covering default confirmation, mandate scope, budget/supplier/booking/refundability/privacy checks, expiry/revocation, offer changes, and high-risk cancellation.
- Added in-memory `ActionRequestService` lifecycle (`pending`, `approved`, `rejected`, `expired`, `executed`) with owner/version checks and one-time consumption; decision metadata, request hash, policy snapshot, and correlation ID are retained internally.
- Added authenticated Nest controllers/modules for mandates and action requests and registered them in `AppModule`.
- Added injectable Gateway execution-policy recheck before commit/redirect tool side effects.
- Added forward-only migration `007_mandates_actions` and database types/runner registration.

## TDD evidence

- RED: `pnpm --filter @travel/domain test -- mandate-policy.test.ts` failed because `../src/mandate/policy-evaluator.js` was absent (`Cannot find module`).
- GREEN: same command now passes: 5 files, 19 tests.
- GREEN: `pnpm --filter @travel/application test -- action-request-service.test.ts` passes: 3 files, 14 tests.

## Verification

- `pnpm --filter @travel/api test -- health.e2e-spec.ts` — 5 files / 23 tests passed (all API suites collected).
- `pnpm --filter @travel/api build` — TypeScript build passed after final controller typing adjustment.
- `pnpm --filter @travel/persistence test -- migrations.test.ts` — 4 files / 7 tests passed; integration tests skipped without DB.
- `pnpm --filter @travel/capability-gateway test` — 1 file / 4 tests passed.
- `pnpm typecheck` — all 13 workspace packages completed successfully.
- Focused lint for domain/application/api/gateway — all clean.
- Root `pnpm test` was rerun after the API import fix; the first run exposed a circular token import, then the targeted API run passed after moving tokens to standalone files. 

## Self-review / concerns

- API modules currently use the mandated in-memory fallback; PostgreSQL tables/migration are present, but durable repositories are intentionally deferred to the persistence task boundary.
- Mandate policy hashes use a deterministic lightweight local hash because `@travel/domain` does not depend on Node typings; cryptographic audit hashing should be centralized when the persistence/audit layer lands.
- Gateway recheck is injectable and enforced when supplied; existing read/prepare planning behavior remains unchanged.
