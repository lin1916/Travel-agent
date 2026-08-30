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

## Fix round 1

- Added RED regressions for duplicate mandate IDs, missing booking execution facts, unauthorized budget overrides, command-bound ActionRequest consumption, and fail-closed Gateway side effects.
- Wired API mandate/action modules to PostgreSQL repositories whenever `DATABASE_URL` is configured; in-memory stores are available only under `NODE_ENV=test` without a database URL.
- Added append-only `MandateRepository`, durable `ActionRequestRepository`, trip-scoped mandate listing, strict `/decisions` request validation, and legacy decision-path compatibility.
- Added forward-only migration `008_action_request_consumed_at` and consumed timestamp persistence.
- Gateway now rejects commit/redirect execution when no evaluator is configured; AgentModule supplies a production evaluator requiring mandate and single-use action context.
- ActionRequest consumption validates kind/resource/request hash and persists a one-time executed state.

Fix-round tests: `pnpm --filter @travel/domain test -- mandate-policy.test.ts` (5 files, 22 passed); `pnpm --filter @travel/application test -- action-request-service.test.ts` (3 files, 15 passed); `pnpm --filter @travel/capability-gateway test -- gateway.test.ts` (1 file, 5 passed); `pnpm --filter @travel/persistence test -- migrations.test.ts` (4 files, 7 passed, 6 integration skipped); `pnpm --filter @travel/api test -- mandates` (5 files, 23 passed). Typechecks/builds for API, application, domain, capability-gateway, and persistence all passed.

Remaining concerns:

- PostgreSQL integration tests remain skipped when `DATABASE_URL` is unset; repository SQL paths were typechecked but not exercised against a live PostgreSQL instance.
- Gateway production evaluator currently enforces presence of `mandateId` and `actionRequestId`; full mandate lookup and one-time decision consumption should be connected when booking side-effect tools are introduced.

## Fix round 2

- Added RED regressions for evaluator-driven one-time consumption and optimistic repository conflicts.
- Gateway execution-policy results now carry a required `consume` callback for commit/redirect tools; the callback runs exactly once immediately before the tool side effect.
- AgentModule now loads the current Mandate and approved ActionRequest, re-evaluates the command with stored execution facts and policy snapshot, and returns a bound consume callback using kind/resource/request hash/version.
- `MandateRepository.listByTrip` now returns only the latest version per mandate, matching the in-memory/API semantics.
- `ActionRequestRepository.save` checks affected-row count and raises a version conflict when a concurrent update wins.

Fix-round 2 tests: `pnpm --filter @travel/capability-gateway test -- gateway.test.ts` (6 passed); `pnpm --filter @travel/persistence test -- persistence-unit.test.ts` (8 passed, 7 integration skipped); `pnpm --filter @travel/api test -- agent-execution-policy.test.ts` (6 files, 24 passed); domain/application focused suites remained green. API, application, domain, Gateway, and persistence typechecks/builds plus lint passed.

Remaining concern: live PostgreSQL integration remains unexecuted because `DATABASE_URL` is not configured in this environment.

## Fix round 3

- Added a RED API regression showing that stale current offer facts and input attempting to replace the approved supplier must both block execution.
- The evaluator now receives current facts from an authoritative provider. In the production module it reads current Trip version, Budget ledger, and booking offer snapshot from PostgreSQL immediately before the side effect; unavailable current facts fail closed.
- The evaluator builds policy input only from the approved ActionRequest and rejects any tool input that supplies a different approved command field. Consumption remains bound to the original kind, resource, hash, and approved version.

Fix-round 3 evidence: RED `pnpm --filter @travel/api test -- agent-execution-policy.test.ts` failed with stale offer facts incorrectly allowed. GREEN: API tests 6 files / 25 passed; Gateway 6 passed; application 15 passed; domain 22 passed; persistence 8 passed with 7 PostgreSQL integration skips. API build/typecheck/lint and `git diff --check` passed.

Remaining concern: live PostgreSQL integration remains unexecuted because `DATABASE_URL` is not configured in this environment.
