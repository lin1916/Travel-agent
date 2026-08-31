# Task 13 implementation report

## Implemented

- Added `@travel/observability` structured redacted logger, correlation helpers, and in-process metric primitives.
- Added security gates for request size/CSRF, secure response headers/cookies, HTTPS supplier allowlists with SSRF rejection, timeout validation, replay protection, and sensitive-output scanning.
- Added TDD redaction/security tests and application audit-service tests.
- Added PostgreSQL-backed append-only `013_audit` migration and `AuditRepository`; durable audit wiring fails closed when `DATABASE_URL` is unavailable.
- Added audit and metrics API modules, API security headers/body limits, CI workflow, OpenAPI stub, and operational runbooks.
- Updated migration registry and migration contract test while leaving migrations `010`–`012` unchanged.

## Verification

- RED: `pnpm --filter @travel/security test` initially failed because `http-security.ts`/`webhook-replay.ts` were absent; observability package was absent before creation.
- GREEN: `pnpm --filter @travel/observability test` — 2 passed; `pnpm --filter @travel/security test` — 9 passed.
- `pnpm --filter @travel/application test -- --run test/audit-service.test.ts` — 37 tests passed.
- Package lint (observability, security, application, persistence, api) passed.
- `pnpm typecheck` passed (14/14 tasks).
- `pnpm test` passed for all non-API packages; API suite has six pre-existing environment-dependent setup failures because `DATABASE_URL` is absent and `OrderModule` requires durable persistence. Webhook/API unit tests that do not need DB passed.

## Concerns

- Metrics are process-local counters intended for endpoint exposure; production aggregation/export remains deployment-specific.
- Existing API integration tests require PostgreSQL configuration; no process-local production fallback was introduced.

## Fix round 1

- Added authenticated `AuthGuard` enforcement to audit reads and retained actor-bound trip filtering.
- Kept durable booking audit sink wiring fail-closed in non-test environments; test-only recording remains explicit.
- Wired Fastify request security hook/body limit and response headers; API pretest/prebuild now builds security/observability dependencies so runtime metrics are present.
- Added request/correlation ID assignment, named travel metrics, webhook metric instrumentation, camelCase redaction, bounded/expiring replay guard, stable hash audit IDs with `ON CONFLICT DO NOTHING`, non-zero sensitive scan CLI, and worker recovery procedures.

### Fix-round verification

- RED/current-state check: API webhook suite initially returned 500 because the newly wired metrics package was not built into the API test dependency graph.
- GREEN: `pnpm --filter @travel/api test -- --run test/webhook.e2e-spec.ts` — webhook tests passed (3/3); unrelated DB-backed suites remain skipped/fail setup without `DATABASE_URL`.
- `pnpm --filter @travel/security test` — 11 passed.
- `pnpm --filter @travel/observability test` — 3 passed.
- `pnpm --filter @travel/persistence test -- --run test/audit-repository.test.ts` — audit idempotency test passed; migration/unit tests passed, PostgreSQL integration tests skipped without DB.
- `pnpm typecheck` and package lint passed after the fix-round changes.

## Fix round 2

- RED: added regressions for production authorization fail-closed and request correlation/metrics; before the fix `booking-service.test.ts` and `planning-orchestrator.test.ts` each failed for the expected missing behavior.
- GREEN: `pnpm --filter @travel/application test -- --run test/booking-service.test.ts` — 39/39 tests passed; `pnpm --filter @travel/agent-runtime test -- --run test/planning-orchestrator.test.ts` — 9/9 passed; `pnpm --filter @travel/contracts build`, `pnpm --filter @travel/agent-runtime build`, and `pnpm --filter @travel/api typecheck` passed.
- Added production fail-closed guard for missing durable audit/transaction providers, request correlation propagation into AgentContext, and runtime metrics hooks for planning, action requests, booking audit, supplier errors, and unknown orders.
