# Real-Model Planning Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a chat-first travel planning workspace that always uses a configured real Responses model in user-facing runtime, displays AMap places and routes, and maintains undoable itinerary and budget drafts without booking or payment.

**Architecture:** Extend the existing modular monolith instead of creating a second application. `ThirdPartyResponsesProvider` implements the current Agent Runtime boundary, while all search, map, itinerary and budget operations remain Capability Gateway tools backed by deterministic domain services. React consumes REST/SSE contracts and renders chat, map and plan state; production state remains PostgreSQL-backed and test state uses explicit test doubles only.

**Tech Stack:** TypeScript, Node.js fetch, Zod, NestJS 11/Fastify, React 19/Vite 6, PostgreSQL/Kysely, SSE, AMap JavaScript API 2.0 and Web Service, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-planning-workspace-design.md`

## Global Constraints

- User-facing development and production runtime must use `ThirdPartyResponsesProvider`; `RuleBasedProvider` is test-only and cannot be selected from the product UI.
- A missing or incompatible real-model configuration must fail explicitly; never silently fall back to the rule provider.
- No booking, redirect, payment, refund, traveler profile or identity-document tool is exposed by this workspace.
- Every model request sets `store: false`; API and AMap secrets stay server-side and never enter Git, logs or browser storage.
- All model-requested capabilities pass through Capability Gateway and deterministic domain validation.
- Anonymous conversation and plan data expires after seven days and can be deleted immediately.
- Planning uses China Standard Time, CNY and GCJ-02 map coordinates.
- New production behavior follows test-first RED/GREEN cycles.

---

### Task 1: Third-Party Responses Provider and Production Wiring

**Files:**
- Create: `packages/agent-runtime/src/responses-provider.ts`
- Create: `packages/agent-runtime/test/responses-provider.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `apps/api/src/modules/agent/agent.module.ts`
- Create: `apps/api/test/agent-provider-composition.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `ThirdPartyResponsesProvider implements LlmProvider`
- Produces: `ResponsesProviderConfig`, `ModelConfigurationError`, `ModelProtocolError`, `ModelRequestError`
- Produces: `createPlanningProvider(environment?: NodeJS.ProcessEnv): LlmProvider`
- Consumes: existing `AgentContext`, `StructuredAgentOutput`, `PlanningOrchestrator`

- [ ] **Step 1: Write provider contract tests**

Test a valid Responses JSON-schema request, explicit `store: false`, Bearer authentication, configurable path, extraction of `output_text`, timeout/error redaction, and rejection of malformed structured output. The fake transport records the request and returns protocol-shaped data; assertions target provider output and emitted HTTP input rather than mock call counts.

- [ ] **Step 2: Run the provider test and verify RED**

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/responses-provider.test.ts`

Expected: FAIL because `ThirdPartyResponsesProvider` and its error types do not exist.

- [ ] **Step 3: Implement the minimal provider**

Implement:

```ts
export interface ResponsesProviderConfig {
  baseUrl: string;
  responsesPath: string;
  apiKey: string;
  model: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  timeoutMs: number;
  fetch: typeof fetch;
}

export class ThirdPartyResponsesProvider implements LlmProvider {
  generatePlan(input: AgentContext): Promise<StructuredAgentOutput>;
}
```

Join `baseUrl` and `responsesPath` without duplicating slashes. Send only a system planning instruction and redacted `AgentContext` fields, set `store: false`, request strict JSON schema output, and parse with a local Zod schema. Do not include response bodies, API keys or raw authorization headers in thrown public errors.

- [ ] **Step 4: Run provider tests and package checks**

Run:

```text
pnpm --filter @travel/agent-runtime exec vitest run test/responses-provider.test.ts
pnpm --filter @travel/agent-runtime typecheck
pnpm --filter @travel/agent-runtime lint
```

Expected: all pass.

- [ ] **Step 5: Write API composition tests**

Assert that a non-test environment without `TRAVEL_LLM_API_KEY` throws `ModelConfigurationError`, a configured environment produces `ThirdPartyResponsesProvider`, and only an explicit `NODE_ENV=test` plus `TRAVEL_AGENT_TEST_PROVIDER=rule` produces `RuleBasedProvider`.

- [ ] **Step 6: Run composition test and verify RED**

Run: `pnpm --filter @travel/api exec vitest run test/agent-provider-composition.spec.ts`

Expected: FAIL because `createPlanningProvider` does not exist and AgentModule always constructs `RuleBasedProvider`.

- [ ] **Step 7: Wire provider and environment template**

Add `createPlanningProvider` to AgentModule, inject it into `PlanningOrchestrator`, and add only blank/documented variable names to `.env.example`:

```text
TRAVEL_LLM_BASE_URL=https://apizh-ai.com
TRAVEL_LLM_RESPONSES_PATH=/responses
TRAVEL_LLM_API_KEY=
TRAVEL_LLM_MODEL=gpt-5.5
TRAVEL_LLM_REASONING_EFFORT=xhigh
TRAVEL_LLM_TIMEOUT_MS=60000
TRAVEL_AGENT_TEST_PROVIDER=
```

- [ ] **Step 8: Run API composition and existing Agent tests**

Run:

```text
pnpm --filter @travel/api exec vitest run test/agent-provider-composition.spec.ts
pnpm --filter @travel/agent-runtime test
pnpm --filter @travel/api typecheck
```

Expected: all pass; existing test suites explicitly opt into the rule provider where module composition requires it.

- [ ] **Step 9: Commit Task 1**

```text
git add .env.example packages/agent-runtime apps/api/src/modules/agent/agent.module.ts apps/api/test/agent-provider-composition.spec.ts
git commit -m "feat: connect real responses planning provider"
```

### Task 2: Conversation Turn Loop and Recoverable Chat API

**Files:**
- Create: `packages/contracts/src/conversation.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/agent-runtime/src/llm-provider.ts`
- Modify: `packages/agent-runtime/src/planning-orchestrator.ts`
- Create: `packages/agent-runtime/test/tool-loop.test.ts`
- Create: `packages/application/src/conversations/conversation-service.ts`
- Create: `packages/application/test/conversation-service.test.ts`
- Modify: `packages/application/src/index.ts`
- Create: `apps/api/src/modules/conversations/conversation.controller.ts`
- Create: `apps/api/src/modules/conversations/conversation.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/conversation.e2e-spec.ts`

**Interfaces:**
- Produces: `Conversation`, `ConversationMessage`, `ConversationTurnEvent`
- Produces: `ConversationService.create`, `get`, `appendUserMessage`, `delete`
- Produces routes: `POST /v1/conversations`, `GET /v1/conversations/:id`, `POST /v1/conversations/:id/messages`, `DELETE /v1/conversations/:id`
- Extends `LlmProvider.generatePlan` with prior sanitized messages and tool-result feedback without giving the provider direct Gateway access.

- [ ] **Step 1: Write failing conversation-service tests**

Cover seven-day expiry, owner/session isolation, ordered messages, immediate deletion, and absence of API keys or sensitive headers in stored records.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @travel/application exec vitest run test/conversation-service.test.ts`

- [ ] **Step 3: Implement in-memory repository boundary and service**

Use a small `ConversationRepository` interface and in-memory implementation for tests. Store sanitized message content, provider name, model, status, created/updated/expires timestamps, current Trip ID and AgentRun ID. Do not introduce login or booking dependencies.

- [ ] **Step 4: Write and verify failing tool-loop tests**

The wished-for behavior is: model emits tool calls, orchestrator executes them through Gateway, model receives redacted tool results, and the final assistant response is based on those results. A provider may request at most eight tool rounds; exceeding the limit fails the run without retrying side effects.

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/tool-loop.test.ts`

- [ ] **Step 5: Implement the bounded tool loop**

Introduce explicit turn input/output types in `llm-provider.ts`; update Responses and rule test providers. Preserve correlation IDs and safe summaries. Remove the current behavior that concatenates raw `source=...` metadata into user-visible assistant text.

- [ ] **Step 6: Write and verify conversation API E2E tests**

Cover create, append, recover, delete, malformed input, expired session and cross-session access. Tests use an explicit test provider, never production fallback.

- [ ] **Step 7: Implement controller/module and run checks**

Run:

```text
pnpm --filter @travel/application test
pnpm --filter @travel/agent-runtime test
pnpm --filter @travel/api exec vitest run test/conversation.e2e-spec.ts
pnpm --filter @travel/api typecheck
```

- [ ] **Step 8: Commit Task 2**

```text
git add packages/contracts packages/application packages/agent-runtime apps/api
git commit -m "feat: add recoverable agent conversations"
```

### Task 3: Place and Route Contracts with AMap Capability

**Files:**
- Create: `packages/contracts/src/map.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/application/src/map/map-service.ts`
- Create: `packages/application/test/map-service.test.ts`
- Modify: `packages/application/src/index.ts`
- Create: `apps/api/src/modules/map/amap-client.ts`
- Create: `apps/api/src/modules/map/map.controller.ts`
- Create: `apps/api/src/modules/map/map.module.ts`
- Create: `apps/api/test/map.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `Place`, `RoutePlan`, `MapProvider`
- Produces: `MapService.searchPlaces`, `geocode`, `planRoute`
- Produces routes: `GET /v1/trips/:tripId/places`, `POST /v1/trips/:tripId/routes`

- [ ] **Step 1: Write failing map contract/service tests**

Cover GCJ-02 coordinates, normalized AMap place IDs, walk/transit/drive routes, invalid coordinate rejection, provider timeout, redacted error messages and route-unavailable results that do not invent distance or duration.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @travel/application exec vitest run test/map-service.test.ts`

- [ ] **Step 3: Implement contracts and service boundary**

Use strict Zod schemas. `RoutePlan` requires distance and duration only when status is `available`; unavailable routes contain an explicit reason and no fabricated numeric data.

- [ ] **Step 4: Write failing AMap/API tests**

Use a local fake HTTP transport to verify server-side key placement, query encoding, response normalization, timeout and error redaction. Assert missing `AMAP_WEB_SERVICE_KEY` fails map routes explicitly.

- [ ] **Step 5: Implement AMap client and API module**

Keep `AMAP_WEB_SERVICE_KEY` and `AMAP_JS_SECURITY_CODE` server-side. Add blank template entries for all three AMap variables. Add domain-level ownership checks before calling AMap.

- [ ] **Step 6: Run focused verification**

```text
pnpm --filter @travel/contracts test
pnpm --filter @travel/application exec vitest run test/map-service.test.ts
pnpm --filter @travel/api exec vitest run test/map.e2e-spec.ts
pnpm --filter @travel/api typecheck
```

- [ ] **Step 7: Commit Task 3**

```text
git add .env.example packages/contracts packages/application apps/api
git commit -m "feat: add amap place and route capability"
```

### Task 4: Versioned Planning Commands, Time Rules and Estimated Budget

**Files:**
- Create: `packages/contracts/src/plan.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/application/src/plans/plan-service.ts`
- Create: `packages/application/test/plan-service.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/agent-runtime/src/tool-registry.ts`
- Create: `apps/api/src/modules/plans/plan.controller.ts`
- Create: `apps/api/src/modules/plans/plan.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/plan.e2e-spec.ts`

**Interfaces:**
- Produces: `TripPlan`, `PlanVersion`, `PlanCommand`, `PlanChangeSet`, `PlanningBudgetSummary`
- Produces: `PlanService.current`, `execute`, `undo`
- Produces Gateway tools for add/move/remove/replace/lock/optimize/check/calculate/undo

- [ ] **Step 1: Write failing plan-service tests**

Cover add, move, remove, replace, lock protection, direct-overlap rejection, soft route/rhythm warnings, group-price calculation, 80/100 percent warnings, optimistic version conflict and exact undo to the preceding version.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @travel/application exec vitest run test/plan-service.test.ts`

- [ ] **Step 3: Implement minimal versioned plan service**

Every accepted command appends a version and change set. Do not mutate a version in place. Planning budget tracks estimated values only and never calls booking ledger transitions.

- [ ] **Step 4: Write failing Gateway/API tests**

Assert all planning commands use `prepare` risk, ownership and expected version; assert booking/payment tools are absent from the registry exposed to the planning Agent.

- [ ] **Step 5: Implement tools and plan API**

Expose current plan, command and undo endpoints. Emit redacted plan/budget events using existing event envelope conventions.

- [ ] **Step 6: Run focused verification**

```text
pnpm --filter @travel/application exec vitest run test/plan-service.test.ts
pnpm --filter @travel/agent-runtime test
pnpm --filter @travel/api exec vitest run test/plan.e2e-spec.ts
pnpm --filter @travel/api typecheck
```

- [ ] **Step 7: Commit Task 4**

```text
git add packages/contracts packages/application packages/agent-runtime apps/api
git commit -m "feat: add versioned travel planning commands"
```

### Task 5: Chat-First React Workspace and AMap Rendering

**Files:**
- Create: `apps/web/src/features/chat/ChatPanel.tsx`
- Create: `apps/web/src/features/chat/ChatMessage.tsx`
- Create: `apps/web/src/features/chat/PlanningDetailsDrawer.tsx`
- Create: `apps/web/src/features/map/TravelMap.tsx`
- Create: `apps/web/src/features/map/amap-loader.ts`
- Create: `apps/web/src/features/plans/PlanTimeline.tsx`
- Create: `apps/web/src/features/plans/PlanBudget.tsx`
- Create: `apps/web/src/features/workspace/PlanningWorkspace.tsx`
- Modify: `apps/web/src/routes/PlannerRoute.tsx`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/features/chat/ChatPanel.test.tsx`
- Create: `apps/web/src/features/map/TravelMap.test.tsx`
- Modify: `apps/web/tests/full-trip-flow.spec.ts`

**Interfaces:**
- Consumes conversation, map, plan and SSE APIs from Tasks 2-4.
- Produces desktop chat/map/plan layout and mobile chat/map/plan tabs.

- [ ] **Step 1: Write failing chat component tests**

Cover initial prompt, message submission, pending/failed/retry states, tool-status disclosure, change summary, undo and no booking/payment controls.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @travel/web exec vitest run src/features/chat/ChatPanel.test.tsx`

- [ ] **Step 3: Implement chat-first route and API client**

Replace the form-first route with chat entry plus a structured details drawer. Validate return date on the client and display Chinese public errors. Keep the old form fields as precise-edit controls rather than the main entry.

- [ ] **Step 4: Write failing map component tests**

Cover credential-missing fallback, category marker model, selection synchronization, route-unavailable state and no automatic browser geolocation request.

- [ ] **Step 5: Implement AMap loader and map panel**

Load the AMap JS API only when a server-delivered public JS key is present. Set security proxy configuration before loading. Never embed secret key values in source. Provide an accessible list fallback.

- [ ] **Step 6: Implement plan timeline, budget and responsive layout**

Desktop uses three columns; mobile uses three tabs. Offer cards include normalized Chinese factor labels and category artwork fallback. Agent execution metadata moves into a collapsible details drawer.

- [ ] **Step 7: Rewrite Playwright E2E and verify RED/GREEN**

The test enters the exact 2026-10-01 to 2026-10-04 Hangzhou request, observes chat/tool/offer/map/plan/budget state, adjusts day two, undoes the change, reloads and deletes the session. Network routes use explicit test fixtures and assert no booking/payment UI.

Run:

```text
pnpm --filter @travel/web test
pnpm --filter @travel/web typecheck
pnpm --filter @travel/web build
pnpm --filter @travel/web test:e2e -- full-trip-flow.spec.ts
```

- [ ] **Step 8: Commit Task 5**

```text
git add apps/web
git commit -m "feat: build chat map and itinerary workspace"
```

### Task 6: Persistence, Expiry, Security and Full Acceptance

**Files:**
- Create: `packages/persistence/src/migrations/015_planning_workspace.ts`
- Modify: `packages/persistence/src/migrations/runner.ts`
- Create: `packages/persistence/src/repositories/conversation-repository.ts`
- Create: `packages/persistence/src/repositories/plan-repository.ts`
- Create: `packages/persistence/src/repositories/map-repository.ts`
- Modify: `packages/persistence/src/index.ts`
- Modify: `packages/persistence/src/types.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `apps/worker/src/jobs/anonymous-session-cleanup-job.ts`
- Create: `packages/testkit/test/planning-workspace.test.ts`
- Modify: `docs/runbooks/local-development.md`
- Modify: `docs/runbooks/release-checklist.md`

**Interfaces:**
- Produces PostgreSQL repositories for conversations, plans, places and routes.
- Produces seven-day cleanup job with idempotent deletion.
- Produces gated live smoke commands that never print credentials.

- [ ] **Step 1: Write failing persistence and cleanup tests**

Cover migration up/down symmetry, ownership, ordered messages, append-only plan versions, expiry selection, idempotent cleanup and deletion of dependent rows. PostgreSQL integration tests skip only when `DATABASE_URL` is absent and report that gate explicitly.

- [ ] **Step 2: Verify RED**

Run the focused persistence and worker tests documented in the new test files.

- [ ] **Step 3: Implement migration, repositories and cleanup job**

Use foreign keys and indexes for session expiry, conversation ordering, current plan lookup and Trip ownership. Store only redacted content and normalized map data.

- [ ] **Step 4: Add complete planning acceptance test**

Exercise real application boundaries with explicit fake model/map transports: conversation, tool loop, offers, map data, plan modification, budget, undo, reload recovery and delete. Assert no sensitive data and no booking/payment tools.

- [ ] **Step 5: Add gated live smoke commands and documentation**

Document local-only checks that require `TRAVEL_LLM_API_KEY`, AMap variables and PostgreSQL. Commands print only `configured`/`missing`, model name, latency and high-level outcome.

- [ ] **Step 6: Run full verification**

```text
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm security:scan-sensitive-output
```

Then start API/Web with secrets present, execute the approved Hangzhou browser scenario, inspect desktop and mobile layouts, and verify API keys are absent from browser network payloads and built assets.

- [ ] **Step 7: Commit Task 6**

```text
git add packages/persistence apps/worker packages/testkit docs/runbooks
git commit -m "feat: persist and secure planning workspace"
```
