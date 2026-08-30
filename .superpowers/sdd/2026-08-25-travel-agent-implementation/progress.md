# SDD ledger — plan: docs/superpowers/plans/2026-08-25-travel-agent-implementation.md

## Workspace and Baseline

- Worktree: .worktrees/travel-agent-implementation
- Branch: codex/travel-agent-implementation
- Starting commit: 1b2dc4f
- Approved spec: docs/superpowers/specs/2026-08-25-travel-agent-design.md
- Implementation plan: docs/superpowers/plans/2026-08-25-travel-agent-implementation.md
- Baseline: repository contains the approved spec/plan and ignore rules; no package.json, source package, or test suite exists yet.
- Baseline test ruling: there is no project test command to run before Task 1; Task 1 owns the first runnable health test.

## Preflight Scan

The scan compares every task against its own files/tests and records every cross-task interface or shared-file boundary. The approved spec is authoritative when the plan is ambiguous.

| Kind | Participants | Shared surface | Scan result and ruling |
| --- | --- | --- | --- |
| Self | Task 1 | Workspace files, health test, runtime shells | Consistent: the failing test precedes the minimal API/Web/Worker/Vault bootstrap and the listed build checks. |
| Self | Task 2 | Contract files and contract tests | Consistent: runtime schemas and error mappings are introduced before downstream consumers. |
| Self | Task 3 | PostgreSQL migrations, repositories, integration tests | Consistent: tests exercise version/idempotency/lease behavior before repository code. |
| Self | Task 4 | Domain rules, application services, API rule test | Consistent: half-open interval and integer-cent policy are explicit in tests and implementation steps. |
| Self | Task 5 | Supplier fixtures, adapters, normalization, ranking | Consistent: adapter contract tests precede mocks and parallel search. |
| Self | Task 6 | Gateway, Agent Runtime, planning API | Consistent: Gateway tests and local provider tests precede implementation; only read/prepare tools are enabled. |
| Self | Task 7 | Web components, API/SSE client, Playwright | Consistent: smoke test precedes responsive UI and the test server configuration is listed. |
| Self | Task 8 | Security package, Vault runtime, auth, grants | Consistent: crypto/leak tests precede encryption and single-use grant code; production KMS is an interface, not a local dependency. |
| Self | Task 9 | Mandate, ActionRequest, policy evaluator | Consistent: policy edge cases precede immutable versions and Gateway enforcement. |
| Self | Task 10 | Booking state, revalidation, orders, redirect | Consistent: state tests precede commit logic; unknown external outcomes remain non-success. |
| Self | Task 11 | Worker, webhook, reconciliation, SSE | Consistent: lease/replay tests precede worker and event delivery implementation. |
| Self | Task 12 | Order projections, settlement, after-sales UI | Consistent: settlement tests precede cancellation/refund commands and Action Center UI. |
| Self | Task 13 | Audit, observability, security hardening, CI/runbooks | Consistent: redaction tests precede instrumentation and operational documents. |
| Self | Task 14 | Full-flow testkit, release checklist, CI wiring | Consistent: deterministic scenario and fault matrix depend on all prior slices and run last. |
| Pair | Tasks 1/2 | Root workspace, package naming, shared contracts | No conflict. Ruling: Task 1 creates workspace infrastructure and package scripts; Task 2 adds the contracts package without changing the runtime boundary. |
| Pair | Tasks 1/3 | infra/compose.yaml and root database scripts | Potential shared-file edit. Ruling: Task 1 creates the minimal Postgres service shape; Task 3 may extend it only for persistence configuration and must preserve health/start commands. |
| Pair | Tasks 1/6 | apps/api bootstrap and package filters | No conflict. Ruling: Task 1 exports the Nest application factory so Task 6 can add modules without rewriting process startup. |
| Pair | Tasks 1/7 | Web package/App shell and Playwright server | No conflict. Ruling: Task 1 owns only the shell; Task 7 owns routes, feature components, and browser fixtures. |
| Pair | Tasks 1/13/14 | Root scripts and CI workflow | Shared contract. Ruling: Task 1 defines all named root scripts as valid no-op/targeted commands where necessary; Tasks 13/14 fill their implementations and CI jobs without renaming scripts. |
| Pair | Tasks 2/4 | Money, Trip, ItineraryItem, BudgetLedger, domain errors | No conflict. Ruling: Task 2 owns Zod/runtime contracts; Task 4 owns pure rule functions and imports contracts without NestJS coupling. |
| Pair | Tasks 2/5 | SearchRequest, OfferPage, NormalizedOffer, ranking types | No conflict. Ruling: adapters validate raw supplier data at the boundary and return the Task 2 contract shapes. |
| Pair | Tasks 2/6 | RiskLevel, AgentContext, EventEnvelope, AppError | No conflict. Ruling: Gateway and Agent Runtime use the shared discriminated types and never invent parallel status strings. |
| Pair | Tasks 2/8/9/10 | Grant, Mandate, ActionRequest, BookingIntent, SupplierOrder types | Security and order boundaries are explicit. Ruling: sensitive values are represented only by refs; Task 10 accepts no traveler plaintext from HTTP. |
| Pair | Tasks 2/11/13 | EventEnvelope, TaskKind, AuditEntry, redacted payloads | No conflict. Ruling: event/audit fields remain stable and all payloads are redacted before persistence or SSE. |
| Pair | Tasks 3/4/5/6 | Persistence repositories and application/domain consumers | Layering is consistent. Ruling: repositories expose records/transactions; domain functions do not issue SQL or HTTP. |
| Pair | Tasks 3/10/11/12/13 | Numbered migrations and aggregate persistence | Migration order is 001 through 010. Ruling: each task adds only its listed migration and never renumbers an earlier migration. |
| Pair | Tasks 4/5/10/12/14 | Budget/time rules, offers, booking settlement, full scenario | No contradiction. Ruling: direct overlaps block; route/rhythm warnings never block; ledger updates are idempotent and tested in the scenario. |
| Pair | Tasks 5/6/10/11/12/14 | SupplierAdapter interface and mock fault modes | No conflict. Ruling: adapters translate only; domain services map accepted/pending/rejected/indeterminate and lifecycle/reconciliation states. |
| Pair | Tasks 6/7/11 | AgentRun, planning endpoints, SSE activity | No conflict. Ruling: UI receives execution summaries and replayable redacted events, never model chain-of-thought or traveler plaintext. |
| Pair | Tasks 8/9/10/12 | Auth, Grant, Mandate, booking/after-sales policy | Security ordering is sound. Ruling: Gateway rechecks policy immediately before every external side effect, including after a prior AgentRun decision. |
| Pair | Tasks 10/11/12/14 | BookingIntent/SupplierOrder lifecycle, callbacks, reconciliation, settlement | No conflict. Ruling: creation_unknown/payment_unknown/manual_review are never success; unknown outcomes always enqueue reconciliation. |
| Pair | Tasks 11/13 | Worker events, correlation IDs, metrics, audit | No conflict. Ruling: event delivery is at-least-once with Inbox dedupe; observability/audit receive stable IDs and redacted fields only. |
| Pair | Tasks 12/14 | Order views and end-to-end UI assertions | No conflict. Ruling: full-flow assertions verify domain state and leak scans, not only visible labels. |

## Preflight Rulings

- Ruling: execute in the isolated worktree on a codex-prefixed branch — required by the selected Subagent-Driven workflow — cost if wrong: local branch cleanup is needed before integration.
- Ruling: use a deterministic local LLM provider until a production model provider is separately approved — preserves privacy and repeatable tests — cost if wrong: a later provider adapter must be added before production.
- Ruling: use Mock/Sandbox suppliers for every external side effect through Task 14 — avoids unapproved external orders and payment effects — cost if wrong: real supplier contract work starts later.
- Ruling: preserve the plan's ten migration filenames and root script names as the cross-task API — prevents later task drift — cost if wrong: a migration or script rename requires a coordinated plan revision.

## Task Checklist

- [x] Task 1: Bootstrap the Monorepo and Health-Check Slice
- [x] Task 2: Define Shared Contracts and Error Semantics
- [x] Task 3: Build PostgreSQL Persistence, Migrations, and Idempotency
- [x] Task 4: Implement Deterministic Trip, Itinerary, Budget, and Time Rules
- [x] Task 5: Add Supplier Contracts, Mock Adapters, Search Normalization, and Ranking
- [x] Task 6: Implement Agent Runtime, Capability Gateway, and Planning API
- [x] Task 7: Build the Anonymous Planning Web Workspace
- [ ] Task 8: Add Authentication, Vault Encryption, and TravelerDataGrant
- [ ] Task 9: Implement TravelMandate, ActionRequest, and Policy Decisions
- [ ] Task 10: Implement BookingIntent Commit, Mock Orders, and Redirects
- [ ] Task 11: Add Worker Tasks, Outbox/Inbox Delivery, Webhooks, Reconciliation, and SSE Replay
- [ ] Task 12: Complete Orders, Budget Settlement, and After-Sales
- [ ] Task 13: Add Audit, Redacted Observability, Security Gates, and Operational Runbooks
- [ ] Task 14: Release the Full Mock Workflow and Prepare Supplier Sandbox Rollout

## Task 1 Review

- Review package: review-1b2dc4f..4bab202.diff
- Reviewer verdict: spec not compliant; task quality needs fixes.
- Important finding: package lint/test scripts do not share the required command shape. API uses eslint src test and vitest run while the other packages use eslint src and vitest run --passWithNoTests.
- Important finding: Worker and Vault have no start script, so their required process entry point cannot be started with the package manager.
- Important finding: root scripts bypass the declared Turbo task pipeline, and pnpm-workspace.yaml contains the malformed placeholder-like allowBuilds value "esbuild: set this to true or false".
- Fix round 1 is required; resume the original implementer and re-run focused workspace checks before scoped re-review.

## Task 1 Fix Loop

- Task 1: fix round 1/5 (4 addressed, 0 open; commits 4bab202..d606d66)
- Scoped re-review: all prior findings addressed; no new Critical/Important breakage.
- Minor deferred: Turbo reports the root dev --parallel option as deprecated; testkit has no dev script and is skipped by Turbo dev. Neither blocks the task.
- Task 1: complete (commits 1b2dc4f..d606d66, review clean)

## Task 2 Review

- Review package: review-d606d66..67007ee.diff
- Reviewer verdict: spec not compliant; task quality needs fixes.
- Important finding: ActionRequestInput/View and CancelRequest/RefundRequest do not match the exact shared interfaces in the brief.
- Important finding: PolicySnapshot.currentBudget is narrowed instead of using the full BudgetLedger contract.
- Important finding: AuditEntry, AuditView, and LogEvent omit or rename required fields.
- Important finding: AppError publicMessage is caller-controlled and can serialize sensitive provider values; internal detail is not safely constrained.
- Important finding: required boundary schemas are missing for supplier/webhook, revalidation/order, action/mandate, and search contracts.
- Fix round 1 is required; resume the Task 2 implementer with these findings and require focused contract/leak tests.

## Task 2 Fix Loop

- Task 2: fix round 1/5 (4 addressed, 1 open; commits 67007ee..87e0b44)
- Scoped re-review approved the fix diff but noted missing schemas for SupplierOrderUpdate and cancellation result contracts.
- Controller verification: the observation is a real remainder of the original boundary-schema finding and is load-bearing for Task 5; it is not deferred.
- Fix round 2 must add runtime schemas and focused tests for every remaining exported supplier boundary type used for adapter input/output.

## Task 2 Fix Loop Continued

- Task 2: fix round 2/5 (1 addressed, 0 open; commits 87e0b44..a3efd96)
- Scoped reviewer retry failed with external 503/high-demand errors twice.
- Controller scoped verification: the fix diff only adds SupplierOrderRef/CreateOrderResponse/SupplierOrderUpdate/CancelSupplierOrder/CancelResult schemas and negative tests; contracts test 8/8, typecheck, build, and lint pass.
- Ruling: prior scoped review approved all existing findings; the unavailable external reviewer is a tooling outage, not an implementation uncertainty. Proceed with the controller verification evidence and carry the diff into final whole-branch review. Cost if wrong: a later reviewer may require a small contract/schema correction before integration.
- Task 2: complete (commits 67007ee..a3efd96, review clean with controller-scoped verification)

## Task 3 Review

- Review package: review-a3efd96..75b5c13.diff
- Reviewer verdict: spec not compliant; task quality moderate but release-blocked.
- P1: EventRepository accepts caller-provided sequence without aggregate-scoped atomic allocation.
- P1: TripRepository has no transaction overload/composable API for state plus Outbox atomicity.
- P2: Inbox external-event unique conflicts are not handled idempotently.
- P2: lease expiry uses less-than instead of inclusive boundary.
- P2: same-hash in-flight idempotency rows are returned as replay with no response.
- Verification gap: Docker/PostgreSQL unavailable; real migration/locking/upsert tests did not run.
- Fix round 1 required; carry all findings to a focused repair and re-review.

## Task 3 Fix Loop

- Task 3: fix round 1/5 implemented in commit 9cef65f.
- Changes: aggregate-scoped atomic event sequence allocation, transaction-aware Trip repository methods, Inbox external-ID dedupe, inclusive lease expiry, canonical request hashing, and explicit in-flight/completed idempotency replay state.
- Verification: persistence unit tests 3 passed; 5 PostgreSQL integration tests skipped because DATABASE_URL and local PostgreSQL tooling are unavailable; package typecheck, build, lint, root typecheck/lint/test/integration command passed.
- Scoped re-review package: review-75b5c13..9cef65f.diff.
- Status: awaiting scoped reviewer verdict; Task 3 is not yet marked complete.

## Additional Deliverable

- Architecture report committed in 5855117 with formatting correction 8de9dff.
- Path: docs/architecture/travel-agent-architecture-report.md.

## Task 3 Fix Loop Completed

- Task 3: fix round 1/5 (5 addressed, 0 open; commits 75b5c13..9cef65f)
- Scoped re-review: approved; no new Critical/Important breakage.
- Minor deferred: transaction rollback integration test asserts Trip and event-log rollback but not the Outbox row explicitly. Carry to Task 11/final review.
- Verification gate deferred: five PostgreSQL integration cases and migration rollback remain unexecuted until DATABASE_URL/PostgreSQL 16 is available.
- Task 3: complete (commits a3efd96..9cef65f, review clean; PostgreSQL execution gate retained)

## Task 4 Dispatch Ruling

- Ruling: the collaboration dispatch interface repeatedly failed to start a fresh Task 4 implementer after successful Task 3 review. The controller will execute the approved Task 4 brief with the same TDD and review gates rather than stall. Cost if wrong: reduced context isolation for this task; an independent task reviewer remains mandatory before completion.

## Task 4 Implementation

- Implementation commit: 4c79bf1.
- Controller self-review fix: budget state transitions and meaningful conservation assertions in b1fff9c.
- RED/GREEN evidence: missing modules/404; release limit/transport warning; validation 500; missing transition function; all corresponding tests subsequently pass.
- Verification: domain 9/9, application 2/2, API 4/4; root typecheck, lint, build, and full test command pass. Five PostgreSQL integration tests remain skipped.
- Review package: review-8de9dff..b1fff9c.diff.
- Independent review: spec noncompliant; task quality needs fixes.
- Critical findings: API uses process-local Maps instead of PostgreSQL source of truth; trip creation and budget initialization lack mandatory idempotency, audit, policy, and atomic recovery boundaries.
- Important findings: mainland-China/CST and integer traveler validation are missing; warning calculation is not wired into itinerary service/API; release/category accounting can cross categories; 80% budget check uses floating point; new persistence tables are absent from the typed Database interface.
- Minor findings: property test is a fixed loop rather than generated property coverage; Clock is unused.
- Task 4 fix round 1 is required before completion and Task 5 dispatch.
- Task 4 fix round 1 dispatched to a fresh repair implementer; awaiting implementation and verification report.
- Task 4: fix round 1/5 (4 addressed, 3 open; commits b1fff9c..8ea3b81). Scoped re-review: persistence wiring, domestic/CST/integer validation, integer threshold arithmetic, and typed Database tables addressed. Open: test-mode idempotency bypass; missing-city/API warning propagation; released transition category validation. PostgreSQL bigint precision remains a residual observation.
- Task 4: fix round 2/5 (2 addressed, 1 open; commits 8ea3b81..2f7e6d2). Scoped re-review: caller header is required, missing-city warnings are exposed, and release transition category validation is addressed. Open: test-only InMemoryTripStore drops caller idempotency keys and cannot replay the supplied key; no new Critical/Important breakage.
- Task 4: fix round 3/5 (0 addressed, 1 open; commits 2f7e6d2..73ef403). Scoped re-review: InMemoryTripStore retains keys, but persistent request hashing includes a newly random trip id so identical retries do not replay; test fallback key scope is global instead of owner-scoped. New Important breakage: scope mismatch between modes. Escalate to a fresh, more capable implementer for round 4.
- Task 4: fix round 4/5 (1 addressed, 0 open; commits 73ef403..0116f04). Scoped re-review: stable caller-input fingerprint, persistent replay, and owner-scoped fallback idempotency all addressed; no new Critical/Important breakage.
- Task 4: minor (deferred): live PostgreSQL bigint precision and idempotency replay remain unexercised until a PostgreSQL instance is available; keep as an integration verification gate.
- Task 4: complete (commits 8de9dff..0116f04, review clean; PostgreSQL execution gate retained).
- Task 5 dispatch: BASE=0116f04; fresh implementer assigned to supplier contracts, deterministic mocks, normalization/ranking, parallel search, search API, and migration 003. Task 5 review gate remains mandatory before Task 6.
- Task 5 review: spec noncompliant; task quality needs fixes.
- Critical findings: flight search is unsupported despite OfferKind=flight; long searches always run inline without recoverable PostgreSQL task/lease/outbox handling.
- Important findings: malformed search bodies can reach `.map()` and fail as server errors; search timestamps do not enforce CST; fault-mode/webhook tests and deterministic out-of-order behavior are incomplete.
- Minor deferred: fixtures are duplicated in TypeScript rather than loaded; equal/absent durations can yield a misleading faster ranking reason.
- Task 5 fix round 1 is required before completion.
- Task 5: fix round 1/5 (4 addressed, 2 open; commits 838212a..837d7d0). Scoped re-review: flight, durable queue selection, strict request validation, and CST normalization addressed. Open: webhook-specific fault modes are not fully exercised across adapters; identical queued-search retry can hit a PostgreSQL task primary-key error because enqueue uses a plain insert. No worker consumer is expected until a later task.
- Task 5: fix round 2/5 (2 addressed, 1 new open; commits 837d7d0..1dc7c81). Scoped re-review: task enqueue replay/conflict and all-adapter webhook coverage addressed. New Important regression: SearchService includes optional `endsAt: undefined` in queued payloads, which canonical JSON rejects; durable 4+ category searches can fail with a TypeError. Fix round 3 required.
- Task 5: fix round 3/5 (1 addressed, 0 open; commits 1dc7c81..0ef5ddd). Scoped re-review: omitted optional `endsAt` is no longer materialized as `undefined`; canonical JSON receives a valid payload and explicit-versus-omitted semantics remain deterministic. No new Critical/Important breakage.
- Task 5: complete (commits 0116f04..0ef5ddd, review clean; PostgreSQL execution gate retained).

## Task 6 Review

- Review package: review-0ef5ddd..828cbf8.diff.
- Reviewer verdict: spec noncompliant; task quality needs fixes.
- Critical: API uses an in-memory AgentRun store, so runs are not persistent or restart-recoverable.
- Important: PostgreSQL repository restoration is incomplete; GET/resume ownership is not enforced; Trip version validation is client-controlled; date-only parsing shifts local dates via UTC; traveler counts above six are silently clamped; no traveler-data redaction boundary exists.
- Minor: search tool schema does not enforce timestamp validity/timezones; request risk is not propagated into orchestration decisions.
- Task 6 fix round 1 required; resume the original implementation agent and run a scoped re-review.

- Task 6: fix round 1/5 (9 addressed, 3 open; commits 828cbf8..b02cb40).
- Scoped re-review: persistence wiring, snapshot restoration, ownership, DB-backed authoritative version lookup, redaction, search schema, and risk propagation addressed.
- Open: CST handling still shifts actual search times backward; Chinese traveler-count syntax such as `7人` is not rejected. New Important breakage: migration 004 was edited instead of versioned forward; unknown Trip in DB-backed anonymous planning fails on the foreign key; CST change regresses real SearchService normalization.
- Task 6 fix round 2 required.

## Task 6 Fix Loop Continued

- Task 6: fix round 2/5 (5 addressed, 0 open; commits b02cb40..a6aa6b3).
- Scoped re-review: all five findings addressed; no new Critical/Important breakage.
- Verification: focused runtime planning 8/8, application SearchService 12/12, persistence migrations 5 passed plus 6 PostgreSQL integration skips, API agent planning 13/13; root typecheck, lint, build, full test, and git diff check passed.
- PostgreSQL migration execution remains unverified because `DATABASE_URL` is unset; migration ordering is covered by focused tests.
- Task 6: complete (commits 828cbf8..34b4eda, review clean; PostgreSQL execution gate retained).

## Task 7 Review

- Implementation commit: 527a921 (`feat: add responsive planning workspace`).
- Verification: Playwright passed at desktop 1440x900 and mobile 390x844; Web lint, typecheck, and build passed.
- Independent review: spec noncompliant; task quality needs fixes.
- Important findings: Playwright runs the Vite development server rather than the required preview server; SSE sends an initial Last-Event-ID but has no retry loop or cursor advancement.
- Additional findings: supplier mode is not rendered; itinerary warnings are not loaded from the API; Agent start drops the in-memory anonymous actor context.
- Task 7 fix round 1 required; covering tests are `apps/web/tests/planner.spec.ts` plus a focused SSE client test.

## Task 7 Fix Loop

- Task 7: fix round 1/5 (5 addressed, 0 open; commits 527a921..1da47c5).
- Scoped re-review: preview-backed Playwright, SSE reconnect/cursor advancement, supplier-mode rendering, API-backed itinerary warnings, and anonymous actor propagation all addressed; no new Critical/Important breakage.
- Fresh controller verification: SSE unit 1/1, Playwright desktop/mobile 2/2, Web lint, typecheck, and build passed. Playwright emitted only the environment-level `NO_COLOR`/`FORCE_COLOR` warning.
- Task 7: minor (deferred): the Playwright `beforeEach` navigates to `/` but does not explicitly reset fixtures; current tests isolate state with unique in-memory actor/trip IDs. Carry to final review.
- Task 7: complete (commits 34b4eda..1da47c5, review clean; fixture-reset observation deferred).

## Task 8 Dispatch Rulings

- Ruling: preserve the already-applied `005_agent_run_summaries` migration and create Task 8 as `006_vault_refs`; shift the remaining planned migrations forward by one number instead of rewriting migration history — forward-only migrations are required for recoverability — cost if wrong: Tasks 9-13 and the final migration documentation need the same one-number adjustment.
- Ruling: strengthen grant consumption to accept the full expected execution binding (intent version, supplier legal entity, traveler IDs, allowed fields, purpose, and offer snapshot hash) and return one `AuthorizedTravelerFields` result per traveler — the approved spec requires every binding to be checked and grants may cover multiple travelers, which the plan's singular two-argument signature cannot represent — cost if wrong: Task 10 integration will need a small adapter around the stronger service interface.
- Ruling: five minutes is the maximum grant lifetime measured from issuance using an injectable clock; caller-provided later expiries are rejected rather than silently extended — this preserves the spec's short-lived authorization boundary — cost if wrong: clients must request a new grant instead of relying on a longer expiry.
- Task 8 dispatch: BASE=`1da47c5`; first implementer=`/root/task8_implementation` exited during an interrupted turn after leaving uncommitted changes; no report or commit was produced.
- Ruling: retain and independently finish the existing Task 8 working-tree changes with a fresh implementer rather than reset or discard them — they are scoped to the task and preserving them avoids losing TDD work; cost if wrong: the fresh implementer may need to simplify or replace partial code before committing.
- Task 8 implementation: commit `491e21d`; report=`task-8-report.md`; required focused tests, typecheck, build, lint, sensitive-output scan, and git diff check reported green; PostgreSQL Vault integration remains skipped because `VAULT_DATABASE_URL` is unset.
- Task 8 review package: `review-1da47c5..491e21d.diff`; independent task review pending.
- Task 8 reviewer dispatched: fresh security-focused reviewer; verdict pending.
- Task 8 review: spec noncompliant; task quality needs fixes. Critical: Vault internal endpoints are exposed without service authentication and return/decrypt sensitive fields based on caller-supplied identity. Important: grant revoke is not owner-bound; dev identity and local KMS are enabled in every non-production environment instead of only development/test. Important privacy observation: retention cutoff is not enforced before authorized reads.
- Task 8 fix round 1/5 dispatched; findings are carried verbatim to the original implementer.
- Task 8 fix round 1/5: commit `92539fc`; four findings addressed in code/tests (internal service auth, grant owner-bound revoke, strict local environment gates, retention read deadline). Scoped re-review package=`review-491e21d..92539fc.diff`; verdict pending.
- Task 8 scoped re-review: all four findings `ADDRESSED`; no new Critical/Important breakage. Out-of-scope observation: owner identity is carried in an authenticated service-token request header rather than independently signed; carry to Task 13/final threat-model review.
- Task 8 minor (deferred): implementation report's earlier concern text still says internal endpoints need future authentication even though the fix added it; documentation cleanup can wait for the final review.
- Task 8: complete (commits `1da47c5..92539fc`, review clean; PostgreSQL Vault execution gate retained).
- Task 9 dispatch preparation: first unfinished task after Task 8; migration number is `007_mandates_actions` because `005_agent_run_summaries` and `006_vault_refs` already exist.
- Task 9 dispatch: BASE=`92539fc`; brief=`task-9-brief.md`; report=`task-9-report.md`; implementation/review pending.
- Ruling: extend `ActionRequestInput`/policy evaluation with optional execution facts (`supplierId`, `bookingType`, `refundable`, `offerSnapshotHash`, and requested sensitive fields) while preserving the brief's required fields — supplier allow-list, refundable-only, price-change, and privacy decisions cannot be evaluated from `resourceId` alone; cost if wrong: the shared contract gains a few optional fields that later clients must populate for strong policy checks.
- Task 9 implementation was amended by the implementer to commit `0299a17` (superseding `bf4bd7d`) after fixing the API build typing issue; report=`task-9-report.md`; focused domain/application/API/persistence/Gateway tests and workspace typecheck reported green.
- Task 9 review package for the amended head must use `92539fc..0299a17`; any review of `bf4bd7d` is obsolete.
- Task 9 reviewer dispatch is being refreshed against the amended head.
- Task 9 review: spec noncompliant; task quality needs fixes. P0: API uses process-local Mandate/ActionRequest Maps instead of PostgreSQL source of truth; Gateway policy recheck is optional and not wired in production. P1: policy fails open when execution facts are missing/unknown, approvals are not command-bound, decision body is not schema-validated, duplicate mandate IDs overwrite history, and mandated trip-scoped/`/decisions` routes are incomplete. P2: lightweight 32-bit policy hash is unsuitable for audit integrity.
- Ruling: treat durable Mandate/ActionRequest persistence and mandatory Gateway recheck as load-bearing Task 9 fixes, not deferred to a later persistence task — global constraints require PostgreSQL as business truth and policy checks immediately before every external side effect; cost if wrong: additional repository wiring now, but deferring would allow unsafe booking behavior.
- Task 9 fix round 1/5 dispatched with all P0/P1 findings; P2 hash is deferred to Task 13 with a ledger pointer.
- Original Task 9 implementer had already terminated; fix round 1 is reassigned to fresh agent `task9_fix` using the existing worktree and same brief/report.

- Task 9 fix round 1: commit `1d8f38c`; focused domain/application/Gateway/persistence/API tests, typechecks, builds, and lint passed. PostgreSQL integration remains skipped without `DATABASE_URL`; Gateway evaluator currently requires mandate/action context and full lookup/consumption is carried to booking side-effect integration.
