# Task 6 implementation report

## Delivered

- Added `@travel/capability-gateway` with typed capability context, allow-list registry, Zod input validation, risk/actor/trip-version/correlation checks, and typed `policy_blocked` errors.
- Added deterministic `@travel/agent-runtime` with `LlmProvider`, `RuleBasedProvider`, resumable `AgentRunStore`, allow-listed planning tools, and parallel planning orchestration. Runtime output contains tool/source/update/risk summaries and no chain-of-thought field.
- Added anonymous planning API endpoints:
  - `POST /v1/agent/runs`
  - `GET /v1/agent/runs/:runId`
  - `POST /v1/agent/runs/:runId/resume`
- Commit/redirect planning requests are rejected without `x-actor-id` authentication.
- Added PostgreSQL `004_agent_runs` migration and persistence types/repository; extended event contracts with AgentRun and ToolCall summary types.

## TDD evidence

1. Gateway tests were written first and failed with `Cannot find module '../src/gateway.js'`.
2. Runtime tests were written first and failed because `@travel/capability-gateway` had no build entry.
3. API tests initially failed with HTTP 404 because the agent module/routes were absent.
4. After implementation, focused tests passed:
   - `pnpm --filter @travel/capability-gateway test` — 4 tests passed.
   - `pnpm --filter @travel/agent-runtime test` — 2 tests passed.
   - `pnpm --filter @travel/api test -- agent-planning.e2e-spec.ts` — 11 tests passed across the API suite (2 agent tests plus existing tests).

## Verification

- `pnpm typecheck` — 12/12 workspace tasks successful.
- `pnpm lint` — 12/12 workspace tasks successful.
- `pnpm build` — 12/12 workspace tasks successful.
- `pnpm test` — 12/12 workspace tasks successful; 8 test files passed and PostgreSQL integration suites skipped when `DATABASE_URL` was absent.

## Residual concerns

- API agent-run state currently uses the deterministic in-memory store; the migration/repository provide the PostgreSQL persistence seam for wiring into a future application service.
- This task intentionally registers only read/prepare planning tools; booking/commit side effects remain unimplemented.

## Round 1 fix report

Addressed all review findings:

- API now injects `AgentRunRepository` whenever `DATABASE_URL` is configured; deterministic in-memory storage is selected only under `NODE_ENV=test`. The orchestrator accepts an explicit persistence boundary and loads runs from it, making production GET/resume restart-recoverable.
- `004_agent_runs` stores raw (redacted/allow-listed) call descriptors separately from tool-call summaries, persists `userMessage` and `currentTripVersion`, and repository serialization/deserialization now round-trips all fields. Added a repository round-trip unit test.
- GET and resume accept `x-actor-id` and enforce run ownership. Trip ownership and version are loaded through `TripService.getAny`; resume fails on an authoritative version change, and gateway contexts carry the owner/version facts.
- Date-only provider inputs are emitted as CST (+08:00) boundaries. Traveler counts outside 1–6 produce a clarifying question rather than clamping.
- User messages are redacted before entering the provider boundary; snapshots expose only allow-listed call descriptors and summaries. No chain-of-thought or sensitive plaintext is returned.
- Search tools now reuse `SearchRequestSchema`; requested risk propagates through provider context, Gateway context, summaries, and confirmation ActionRequests. Unauthenticated commit/redirect start and resume requests are policy-blocked.

Fix coverage and verification:

- `pnpm --filter @travel/capability-gateway test` — 4 passed.
- `pnpm --filter @travel/agent-runtime test` — 6 passed (CST parsing, >6 clarification, redaction, authoritative version, ownership/risk cases included).
- `pnpm --filter @travel/persistence test` — 4 passed, 6 PostgreSQL integration tests skipped without `DATABASE_URL`.
- `pnpm --filter @travel/api test -- agent-planning.e2e-spec.ts` — 12 passed across the API suite, including GET/resume ownership.
- `pnpm typecheck` — 12/12 workspace tasks successful.
- `pnpm lint` — 12/12 workspace tasks successful.
- `pnpm build` — 12/12 workspace tasks successful.
- `pnpm test` — 12/12 workspace tasks successful; PostgreSQL integration suites skipped when `DATABASE_URL` was absent.

Residual concern: production deployments must run the migration runner before enabling the API with `DATABASE_URL`; no booking/commit supplier side effects are registered in this task.

## Round 1 implementation fix details

Changed files include the agent controller/module, runtime run/persistence/orchestration/provider/tool registry, capability gateway, application trip/version and timestamp helpers, persistence migration/types/repository, and focused runtime/persistence/API tests.

The API now injects `AgentRunRepository` for every non-test process configured with `DATABASE_URL`; only explicit `NODE_ENV=test` uses the deterministic local store. The repository row includes redacted user text, current trip version, safe call descriptors, summaries, action requests, and next step; the round-trip test verifies serialization and restoration.

Ownership and concurrency checks now cover GET/resume actor headers, authoritative `TripService.getAny` ownership/version lookup, gateway owner/version context, and conflict responses after a trip version changes. Date-only planning stays in CST (`+08:00`), invalid traveler counts ask for correction, and provider context plus run snapshots redact phone/ID/payment/passport/password-like values. Search tool validation delegates to `SearchRequestSchema`; requested risk is propagated and authenticated commit/redirect requests create a confirmation ActionRequest, while unauthenticated requests are blocked on both start and resume.

Fix-test evidence:

- `pnpm --filter @travel/capability-gateway test` → 4 passed.
- `pnpm --filter @travel/agent-runtime test` → 7 passed.
- `pnpm --filter @travel/persistence test` → 4 passed; 6 DB integration tests skipped without `DATABASE_URL`.
- `pnpm --filter @travel/api test -- agent-planning.e2e-spec.ts` → 12 passed.
- `pnpm --filter @travel/application test -- search-service.test.ts` → 11 passed across the application test run.
- `pnpm typecheck` → 12/12 successful.
- `pnpm lint` → 12/12 successful.
- `pnpm build` → 12/12 successful.
- `pnpm test` → 12/12 successful; DB integration suites skipped without `DATABASE_URL`.

Remaining operational note: deployments must apply `004_agent_runs` before serving durable agent endpoints; booking/commit supplier side effects remain intentionally out of scope.

## Round 2 fix report

Addressed all five scoped findings:

- `normalizeChinaStandardTime` now preserves the local wall-clock components of explicit `+08:00` values, while retaining UTC/other-offset conversion behavior. Provider date-only midnight therefore remains `2026-09-01T00:00:00.000+08:00` through `SearchService` and supplier adapter calls.
- Traveler parsing now recognizes both `7 travelers` and `7人`; counts outside 1–6 produce the existing clarification response.
- Migration `004_agent_runs` is unchanged after its original schema definition. New migration `005_agent_run_summaries` adds `tool_call_summaries_json` for databases where 004 was already recorded.
- Planning now rejects a missing authoritative Trip before creating an agent run. The API maps this to the existing controlled `validation_error` response (HTTP 400); valid anonymous planning remains supported for existing Trips.
- Added focused runtime, application/SearchService, persistence migration, and API regression coverage.

Verification commands and outputs:

```text
pnpm --filter @travel/agent-runtime test -- planning-orchestrator.test.ts
Test Files  1 passed (1)
Tests       8 passed (8)

pnpm --filter @travel/application test -- search-service.test.ts
Test Files  2 passed (2)
Tests       12 passed (12)

pnpm --filter @travel/persistence test -- migrations.test.ts
Test Files  3 passed | 3 skipped (6)
Tests       5 passed | 6 skipped (11)

pnpm --filter @travel/api test -- agent-planning.e2e-spec.ts
Test Files  4 passed (4)
Tests       13 passed (13)

pnpm typecheck
Tasks:    12 successful, 12 total

pnpm lint
Tasks:    12 successful, 12 total

pnpm build
Tasks:    12 successful, 12 total

pnpm test
Tasks:    12 successful, 12 total
PostgreSQL integration tests skipped because DATABASE_URL was unset.

git diff --check
No whitespace errors reported.
```

Residual concern: the database-backed migration path was not exercised against PostgreSQL in this environment because `DATABASE_URL` was unset; the forward migration is registered and covered by migration-order tests.
