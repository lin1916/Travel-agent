# Task 5 Implementation Report

Date: 2026-08-30

## Changed Files

- `packages/contracts/src/search.ts`: added `SearchRequest`, `NormalizedOffer`, `RankedOffer`, `RankingMode`, and source/timestamp-aware `OfferPage` contracts and schemas.
- `packages/supplier-adapters/package.json`, `tsconfig.json`: added the workspace package.
- `packages/supplier-adapters/src/adapter.ts`: added the supplier adapter boundary and retryable adapter error.
- `packages/supplier-adapters/src/mock/fault-mode.ts`: added the deterministic fault-mode union.
- `packages/supplier-adapters/src/mock/base-mock-adapter.ts`: added fixture normalization, stable snapshot hashing, and mock order/webhook behavior.
- `packages/supplier-adapters/src/mock/mock-{transport,stay,attraction,dining}-adapter.ts`: added four mock adapters.
- `packages/supplier-adapters/src/index.ts`: added package exports.
- `packages/supplier-adapters/fixtures/{transport,stay,attraction,dining}.json`: added credential-free raw fixture payloads.
- `packages/application/src/search/{normalizer,ranker,search-service}.ts`: added deterministic normalization, explainable ranking, and `Promise.allSettled` category isolation.
- `packages/application/test/search-service.test.ts`: added search orchestration/ranking tests.
- `packages/application/src/index.ts`, `package.json`: exported and linked search services.
- `apps/api/src/modules/search/{search.controller,search.module,search.tokens}.ts`: added `POST /v1/trips/:tripId/searches` with owner/request validation and mock providers.
- `apps/api/src/app.module.ts`, `apps/api/package.json`: registered and linked the search module/package.
- `apps/api/test/search.e2e-spec.ts`: added endpoint and ownership tests.
- `packages/persistence/migrations/003_offers.ts`: added the offers persistence migration.
- `packages/persistence/src/types.ts`, `src/migrations/runner.ts`: registered the offers table in the database model and migration runner.
- `pnpm-lock.yaml`: updated workspace dependency links.

## TDD Evidence

### Red

Immediately after writing the adapter tests, `pnpm --filter @travel/supplier-adapters test` failed with `No projects matched the filters` because the package and adapters did not yet exist. This was the expected absence failure from the brief.

### Green

- `pnpm --filter @travel/supplier-adapters test` -> 1 file, 6 tests passed.
- `pnpm --filter @travel/application test -- search-service.test.ts` -> 2 files, 7 tests passed.
- `pnpm --filter @travel/api test -- search.e2e-spec.ts` -> 3 files, 6 tests passed (including existing health/trip suites).

## Verification

- `pnpm typecheck` -> Turbo completed successfully for all 10 packages.
- `pnpm lint` -> Turbo completed successfully for all 10 packages.
- `pnpm build` -> Turbo completed successfully for all 10 packages.
- `git diff --check` -> no whitespace errors.

## Residual Concerns

- Search results are currently mock-only by design; no real suppliers, payments, or credentials are integrated.
- The API executes short searches inline and uses the existing task boundary for deterministic four-category queued searches; a worker that consumes search tasks remains outside this repair round.
- Offer persistence has the migration/schema boundary, but search-result repository writes are intentionally deferred to keep Task 5 within the brief.

## Repair Round 1 (2026-08-30)

Addressed the independent review findings:

- Transport now supports both `train` and `flight` requests, with deterministic flight fixture offers and API provider wiring.
- Searches with four or more category requests use a deterministic queued path (`status: queued`, `taskKind: search`, stable `search-*` task id). PostgreSQL deployments use the existing `TaskRepository`; tests use an in-memory queue only when PostgreSQL is unavailable.
- The API validates the complete request body with a strict Zod schema before mapping kinds, including null/malformed body handling.
- Search request and supplier timestamps require explicit timezone information and are normalized to China Standard Time (`+08:00`).
- Fault-mode tests now cover all four adapters; out-of-order webhooks emit a confirmed event followed by a deterministic lifecycle regression event, while prompt-injection text remains inert title data.

### Repair TDD Red Evidence

- Flight test initially failed with `adapter kind mismatch: flight`.
- Queue test initially returned inline offers and did not enqueue.
- CST test initially observed `2026-08-30T00:00:00.000Z` instead of a `+08:00` timestamp.
- API malformed-body test initially produced HTTP 500 from `body.kinds` access.
- API four-category test initially returned HTTP 201 inline instead of HTTP 202 queued.

### Repair Green Evidence

- `pnpm --filter @travel/supplier-adapters test -- adapter-contract.test.ts` -> 14 tests passed.
- `pnpm --filter @travel/application test -- search-service.test.ts` -> 9 tests passed.
- `pnpm --filter @travel/api test -- search.e2e-spec.ts` -> 9 tests passed, including existing health/trip suites.
- `pnpm --filter @travel/application typecheck`, `pnpm --filter @travel/api typecheck`, `pnpm --filter @travel/supplier-adapters typecheck`, and `pnpm --filter @travel/persistence typecheck` -> passed.
