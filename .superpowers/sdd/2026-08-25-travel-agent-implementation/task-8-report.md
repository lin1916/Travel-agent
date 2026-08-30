# Task 8 implementation report

Date: 2026-08-30

## Status

Task 8 is implemented in the isolated worktree. Existing migration 005_agent_run_summaries was preserved; the Task 8 API migration is 006_vault_refs.

## Implementation

- Added @travel/security envelope crypto using AES-256-GCM, associated-data authentication, environment-backed development key material, key-version lookup, and fail-closed decryption.
- Added recursive redacted serialization for logs/events; crypto and redaction tests cover round trips, wrong associated data, unavailable key versions, plaintext exclusion, and nested leak prevention.
- Added isolated Vault repositories/schema for encrypted per-field traveler records, owner/retention/deletion metadata, and single-use traveler-data grants.
- Added grant issue/consume/revoke flows. Grants bind intent ID/version, supplier legal entity, traveler IDs, allowed fields, purpose, offer snapshot hash, authorization reference, expiry (at most five minutes from issuance), and maxUses=1. Consumption is atomic and returns authorized fields for every traveler; replay, expiry, revocation, and any binding mismatch fail closed.
- Added local-only development identity provider, session verification, AuthGuard, auth module/controller, and authenticated traveler/grant API modules. Anonymous agent planning remains accessible.
- Added API-side TravelerVaultRef persistence and owner/field checks. API persistence stores references and metadata only, never traveler plaintext. Deletion now verifies ownership and recorded field membership before calling Vault and checks the reference-store update result.
- Added Vault runtime wiring, isolated database migration runner, environment examples, package wiring, and tests.

## Files changed

Security: packages/security/src/{crypto,kms,redaction,index}.ts, packages/security/test/crypto.test.ts, package metadata.

Vault: apps/vault/src/{index,main,vault.module}.ts, vault/grants modules and repositories, integration/module tests, package metadata/config.

API: apps/api/src/modules/auth/*, apps/api/src/modules/travelers/*, app module wiring, and apps/api/test/travelers.e2e-spec.ts.

Persistence: packages/persistence/migrations/006_vault_refs.ts, migration runner/types/index exports, traveler-vault-ref-repository.ts, and repository/migration tests.

## TDD RED/GREEN evidence

The resumed worktree already contained the partial crypto/Vault/grant implementation and its tests, so those suites were initially green when audited. I added a missing owner-check regression test before changing production code:

1. RED: pnpm --filter @travel/api exec vitest run test/travelers.e2e-spec.ts failed 1 of 10 tests; unowned deletion returned HTTP 200 instead of the expected 403.
2. GREEN: after the controller fix, the same command passed all 10 tests.

## Verification commands and results

- pnpm --filter @travel/security test — 1 file, 5 tests passed.
- pnpm --filter @travel/vault test — 3 files, 16 passed, 2 PostgreSQL tests skipped because VAULT_DATABASE_URL was not configured.
- pnpm --filter @travel/api exec vitest run test/travelers.e2e-spec.ts — 1 file, 10 tests passed.
- pnpm typecheck — Turbo: 13/13 tasks successful.
- pnpm build — Turbo build completed successfully for all workspace packages.
- pnpm lint — Turbo: 13/13 tasks successful.
- pnpm security:scan-sensitive-output — no matches emitted by the configured scan.
- git diff --check — no whitespace errors (only normal CRLF conversion warnings).

## Self-review

- Grant authorization compares the complete execution binding, not just intent version.
- Grant expiry is bounded from the issuing clock and consumption rejects expired/revoked/used records.
- PostgreSQL consumption uses a conditional update with returningAll() for one-use atomicity; in-memory tests cover concurrent consumers.
- Decrypted values are returned only through field-specific Vault service operations; errors exposed by API/Vault controllers are generic and do not include input values.
- Local key provider refuses production mode and unsupported/missing configuration.
- Migration ordering explicitly retains 005_agent_run_summaries before 006_vault_refs.

## Concerns / follow-up

- PostgreSQL Vault integration tests are conditional on VAULT_DATABASE_URL and were skipped in this environment; run them against the isolated Vault database in CI or staging.
- Internal Vault HTTP endpoints are intended for a private service boundary; deployment should enforce network/service authentication before production exposure.
- API TravelerVaultRef deletion is conservative: deleting one field marks the reference deleted, preventing further grants until the reference is recreated.
