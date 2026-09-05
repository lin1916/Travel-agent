# Conversation-First Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the form-gated demo with a Conversation-first travel Agent in which every user chat message reaches the configured real model, map search and candidate places work before Trip creation, and accepted proposals become versioned plans.

**Architecture:** Add Conversation-scoped planning context, candidate and proposal services behind repository boundaries. Extend the existing Agent Runtime so a model can update planning context through Capability Gateway, create or update a Trip deterministically when enough fields exist, and continue the same turn with Trip-aware tools. NestJS exposes cookie-owned Conversation APIs, and React renders one continuous chat/map workspace with recoverable progress events.

**Tech Stack:** TypeScript 5.8, Node.js 24-compatible fetch, Zod, NestJS 11/Fastify, React 19/Vite 6, PostgreSQL/Kysely, SSE, AMap JavaScript API 2.0 and Web Service, Vitest, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-conversation-first-planning-design.md`

## Global Constraints

- Every user-submitted chat message must invoke the configured real `ThirdPartyResponsesProvider` or real Pi-backed provider path; no UI, rule provider, Sandbox Agent, or local template may produce a successful assistant reply.
- `RuleBasedProvider` remains test-only and is never a runtime fallback.
- Initial product copy may be static, but every reply after user submission comes from a real AgentRun.
- Conversation and map search work before a Trip exists.
- Runtime scope requires at least one of `conversationId` or `tripId`; Conversation message flows always provide `conversationId`, while the existing direct Trip Agent API remains compatible.
- Agent-proposed places do not become candidates until the user accepts the place or accepts the containing proposal.
- The Agent may create `PlanProposal`; only a user command accepts or rejects it and creates a `PlanVersion`.
- Raw hidden chain-of-thought, system prompts, credentials, cookies, authorization headers, and internal JSON are never returned to the browser or logs.
- Reasoning UI shows only model-provided summaries and deterministic tool/progress facts.
- Model requests always set `store: false`; AMap server keys remain server-side.
- The planning surface exposes only `read` and `prepare` capabilities and never booking, redirect, payment, refund, traveler-profile, or identity-document tools.
- Anonymous data expires after seven days and is immediately removable.
- Development memory mode remains explicitly gated by `NODE_ENV=development`, `LOCAL_PLANNING_MEMORY_MODE=true`, and an empty `DATABASE_URL`.
- Ordinary development and production continue to require PostgreSQL; database failure never triggers an automatic memory fallback.
- Planning uses China Standard Time, CNY, and GCJ-02 coordinates.
- Preserve unrelated dirty-worktree changes. Stage only task-owned files; never run `git reset --hard` or `git clean`.
- All production behavior follows a failing-test-first RED/GREEN cycle.

## File Responsibility Map

- `packages/contracts/src/planning-context.ts`: public PlanningContext and patch schemas.
- `packages/contracts/src/candidate-place.ts`: Conversation candidate contracts and commands.
- `packages/contracts/src/plan-proposal.ts`: temporary proposal, acceptance and rejection contracts.
- `packages/application/src/planning-context/planning-context-service.ts`: ownership, validation, versioning and Trip-readiness rules.
- `packages/application/src/candidates/candidate-service.ts`: explicit user-owned candidate persistence rules.
- `packages/application/src/proposals/plan-proposal-service.ts`: proposal lifecycle and acceptance orchestration.
- `packages/agent-runtime/src/planning-orchestrator.ts`: optional-Trip AgentRun and bounded model/tool loop.
- `packages/agent-runtime/src/conversation-tools.ts`: pre-Trip planning-context, map and candidate-read tools.
- `apps/api/src/modules/agent/planning-runtime.module.ts`: one shared Gateway, provider, orchestrator and AgentRun store per application.
- `apps/api/src/modules/sessions/anonymous-session.module.ts`: reusable cookie identity for all anonymous planning controllers.
- `apps/api/src/modules/conversations/*`: all-message Agent execution, recovery and SSE.
- `apps/api/src/modules/candidates/*`: Conversation candidate HTTP API.
- `apps/api/src/modules/proposals/*`: proposal read/accept/reject HTTP API.
- `packages/persistence/src/migrations/016_conversation_first_planning.ts`: durable schema changes.
- `apps/web/src/features/session/ConversationWorkspace.tsx`: page-level Conversation-first state owner.
- `apps/web/src/features/map/PlaceSearch.tsx`: always-enabled place search and result actions.
- `apps/web/src/features/candidates/CandidatePlaceList.tsx`: candidate list and removal.
- `apps/web/src/features/proposals/PlanProposalCard.tsx`: proposal review and acceptance.
- `apps/web/src/features/agent/AgentProgress.tsx`: safe reasoning summaries and execution status.

---

### Task 1: Planning Context Contracts and Versioned Service

**Files:**
- Create: `packages/contracts/src/planning-context.ts`
- Modify: `packages/contracts/src/conversation.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/application/src/planning-context/planning-context-service.ts`
- Create: `packages/application/test/planning-context-service.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Produces: `PlanningContext`, `PlanningContextPatch`, `PlanningContextField`, `TripDraft`.
- Produces: `PlanningContextRepository`, `InMemoryPlanningContextRepository`, `PlanningContextService`.
- Produces: `PlanningContextService.initialize`, `get`, `applyPatch`, `tripDraft`, `delete`.
- Consumes: `ApplicationError`, Conversation/session ownership and existing `CreateTripCommand` validation rules.

- [ ] **Step 1: Write failing PlanningContext contract and service tests**

Create tests with literal expectations:

```ts
it('merges model patches under optimistic version control', async () => {
  const service = planningContextService();
  const initial = await service.initialize('session-1', 'conversation-1');

  const updated = await service.applyPatch('session-1', 'conversation-1', {
    destination: '杭州',
    startsAt: '2026-10-01T00:00:00+08:00',
    endsAt: '2026-10-04T00:00:00+08:00',
    travelerCount: 2,
    totalBudgetCents: 500_000,
    preferences: ['人文景点', '本地餐馆'],
  }, initial.version);

  expect(updated).toMatchObject({
    version: 2,
    destination: '杭州',
    travelerCount: 2,
    missingFields: [],
  });
});

it('does not produce a Trip draft until required values or an explicit one-person assumption exist', async () => {
  const service = planningContextService();
  const initial = await service.initialize('session-1', 'conversation-1');
  const partial = await service.applyPatch('session-1', 'conversation-1', {
    destination: '杭州',
    startsAt: '2026-10-01T00:00:00+08:00',
    endsAt: '2026-10-04T00:00:00+08:00',
  }, initial.version);

  expect(service.tripDraft(partial)).toBeUndefined();
  expect(partial.missingFields).toEqual(['travelerCount']);
});
```

Also cover cross-session access, invalid date order, traveler count outside 1–6, negative budget, duplicate preference removal, version conflict and explicit `assumptions: ['traveler_count_defaulted_to_1']`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```text
pnpm --filter @travel/application exec vitest run test/planning-context-service.test.ts
```

Expected: FAIL because the PlanningContext contracts and service do not exist.

- [ ] **Step 3: Add strict PlanningContext schemas**

Implement the public shape in `planning-context.ts`:

```ts
export const PlanningContextPatchSchema = z.object({
  destination: z.string().trim().min(1).max(120).optional(),
  origin: z.string().trim().min(1).max(120).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  travelerCount: z.number().int().min(1).max(6).optional(),
  totalBudgetCents: z.number().int().nonnegative().optional(),
  preferences: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  assumptions: z.array(z.enum(['traveler_count_defaulted_to_1'])).max(1).optional(),
}).strict();

export interface PlanningContext {
  conversationId: string;
  version: number;
  destination?: string;
  origin?: string;
  startsAt?: string;
  endsAt?: string;
  travelerCount?: number;
  totalBudgetCents?: number;
  preferences: string[];
  assumptions: Array<'traveler_count_defaulted_to_1'>;
  missingFields: PlanningContextField[];
  updatedAt: string;
}
```

Expose `planningContext?: PlanningContext` on `Conversation` without placing the private session ID in contracts.

- [ ] **Step 4: Implement the repository boundary and minimal service**

Use this exact service boundary:

```ts
export interface PlanningContextRepository {
  create(record: StoredPlanningContext): Promise<void>;
  get(conversationId: string): Promise<StoredPlanningContext | undefined>;
  save(record: StoredPlanningContext, expectedVersion: number): Promise<void>;
  delete(conversationId: string): Promise<void>;
}

export class PlanningContextService {
  initialize(sessionId: string, conversationId: string): Promise<PlanningContext>;
  get(sessionId: string, conversationId: string): Promise<PlanningContext>;
  applyPatch(sessionId: string, conversationId: string, patch: PlanningContextPatch, expectedVersion: number): Promise<PlanningContext>;
  tripDraft(context: PlanningContext): TripDraft | undefined;
  delete(sessionId: string, conversationId: string): Promise<void>;
}
```

`tripDraft` returns `destination`, `startsAt`, `endsAt`, `travelerCount` and `totalBudgetCents`. It may use one traveler only when the explicit assumption is present. It never creates a Trip itself.

- [ ] **Step 5: Run focused package verification**

Run:

```text
pnpm --filter @travel/application exec vitest run test/planning-context-service.test.ts
pnpm --filter @travel/contracts typecheck
pnpm --filter @travel/application typecheck
pnpm --filter @travel/application lint
```

Expected: all pass.

- [ ] **Step 6: Commit Task 1**

```text
git add packages/contracts/src/planning-context.ts packages/contracts/src/conversation.ts packages/contracts/src/index.ts packages/application/src/planning-context/planning-context-service.ts packages/application/test/planning-context-service.test.ts packages/application/src/index.ts
git commit -m "feat: add conversation planning context"
```

---

### Task 2: Candidate Places and User-Accepted Plan Proposals

**Files:**
- Create: `packages/contracts/src/candidate-place.ts`
- Create: `packages/contracts/src/plan-proposal.ts`
- Modify: `packages/contracts/src/plan.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/application/src/candidates/candidate-service.ts`
- Create: `packages/application/src/proposals/plan-proposal-service.ts`
- Modify: `packages/application/src/plans/plan-service.ts`
- Create: `packages/application/test/candidate-service.test.ts`
- Create: `packages/application/test/plan-proposal-service.test.ts`
- Modify: `packages/application/src/index.ts`

**Interfaces:**
- Produces: `CandidatePlace`, `CandidateSource`, `PlanProposal`, `PlanProposalDraft`, `ProposalAcceptanceResult`.
- Produces: `CandidateRepository`, `InMemoryCandidateRepository`, `CandidateService`.
- Produces: `PlanProposalRepository`, `InMemoryPlanProposalRepository`, `PlanProposalService`.
- Extends: `PlanService.acceptProposal` to append one PlanVersion for the accepted itinerary.
- Consumes: `Place`, `PlanItemInput`, `PlanningContext`, `PlanContext`, existing overlap/budget/version rules.

- [ ] **Step 1: Write failing candidate tests**

Cover user consent and ownership:

```ts
it('stores a manually accepted map result before a Trip exists', async () => {
  const service = candidateService();
  const saved = await service.add('session-1', 'conversation-1', {
    place,
    source: 'user_search',
  });

  expect(saved.conversationId).toBe('conversation-1');
  expect(saved).not.toHaveProperty('tripId');
  await expect(service.list('session-1', 'conversation-1')).resolves.toEqual([saved]);
});

it('does not expose an operation that saves an unaccepted agent suggestion', () => {
  expect(CandidateSourceSchema.options).toEqual(['user_search', 'accepted_agent_proposal']);
});
```

Also cover provider-place deduplication, removal, priority update, cross-session denial and deletion with the Conversation.

- [ ] **Step 2: Write failing proposal acceptance tests**

Use a proposal with two proposed places and two itinerary items. Assert:

- creation leaves the candidate list empty;
- accepting one place creates exactly one `accepted_agent_proposal` candidate;
- accepting the whole proposal creates one new PlanVersion and all remaining candidates;
- rejecting writes no candidates and no PlanVersion;
- stale proposal version, stale planning-context version and stale plan version return `conflict`;
- accepting twice with the same idempotency key returns the original result;
- accepting twice with the same key and different request returns `conflict`;
- creating a replacement Proposal expires the previous pending Proposal and `current` returns only the replacement;
- reading or accepting after `expiresAt` transitions the Proposal to `expired` and rejects acceptance without candidates or a PlanVersion.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```text
pnpm --filter @travel/application exec vitest run test/candidate-service.test.ts test/plan-proposal-service.test.ts
```

Expected: FAIL because candidate/proposal services and `PlanService.acceptProposal` do not exist.

- [ ] **Step 4: Add strict candidate and proposal contracts**

Use these public states:

```ts
export type CandidateSource = 'user_search' | 'accepted_agent_proposal';

export interface CandidatePlace {
  id: string;
  conversationId: string;
  place: Place;
  source: CandidateSource;
  note?: string;
  priority?: number;
  createdAt: string;
}

export interface PlanProposal {
  id: string;
  conversationId: string;
  tripId: string;
  version: number;
  planningContextVersion: number;
  proposedPlaces: Place[];
  itinerary: PlanItemInput[];
  budgetSummary: PlanningBudgetSummary;
  warnings: ItineraryWarning[];
  reasoningSummary?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
}
```

Extend `PlanChangeSet.command` with `'accept_proposal'`.

- [ ] **Step 5: Implement CandidateService**

Use methods `add`, `addAcceptedProposalPlaces`, `list`, `remove`, `setPriority` and `deleteConversation`. Only public user-command handlers call write methods. Agent tools receive `list` only.

- [ ] **Step 6: Implement proposal lifecycle and one-version acceptance**

Use this boundary:

```ts
export class PlanProposalService {
  create(sessionId: string, draft: PlanProposalDraft): Promise<PlanProposal>;
  current(sessionId: string, conversationId: string): Promise<PlanProposal | undefined>;
  acceptPlace(sessionId: string, conversationId: string, proposalId: string, input: AcceptProposalPlaceInput): Promise<CandidatePlace>;
  accept(sessionId: string, conversationId: string, proposalId: string, input: AcceptProposalInput): Promise<ProposalAcceptanceResult>;
  reject(sessionId: string, conversationId: string, proposalId: string, expectedVersion: number): Promise<PlanProposal>;
  deleteConversation(sessionId: string, conversationId: string): Promise<void>;
}
```

Add `PlanService.acceptProposal(tripId, ownerId, items, expectedVersion, context)`. It validates every interval and the complete overlap set before appending exactly one immutable version with `changeSet.command = 'accept_proposal'`.

Creating a Proposal expires any prior pending Proposal for the same Conversation. `current` and acceptance compare `expiresAt` against the injected clock and persist the `expired` transition before returning the public expiry error. The in-memory implementation snapshots its three stores before acceptance and restores them if any write fails. Task 6 replaces this with a PostgreSQL transaction.

- [ ] **Step 7: Run focused verification**

Run:

```text
pnpm --filter @travel/application exec vitest run test/candidate-service.test.ts test/plan-proposal-service.test.ts test/plan-service.test.ts
pnpm --filter @travel/contracts typecheck
pnpm --filter @travel/application typecheck
pnpm --filter @travel/application lint
```

Expected: all pass and existing plan command behavior remains unchanged.

- [ ] **Step 8: Commit Task 2**

```text
git add packages/contracts/src/candidate-place.ts packages/contracts/src/plan-proposal.ts packages/contracts/src/plan.ts packages/contracts/src/index.ts packages/application/src/candidates packages/application/src/proposals packages/application/src/plans/plan-service.ts packages/application/test/candidate-service.test.ts packages/application/test/plan-proposal-service.test.ts packages/application/src/index.ts
git commit -m "feat: add candidate and proposal lifecycle"
```

---

### Task 3: Conversation-Aware Agent Runtime and Safe Progress Events

**Files:**
- Modify: `packages/contracts/src/events.ts`
- Modify: `packages/contracts/src/conversation.ts`
- Modify: `packages/agent-runtime/src/llm-provider.ts`
- Modify: `packages/agent-runtime/src/agent-run.ts`
- Modify: `packages/agent-runtime/src/planning-orchestrator.ts`
- Modify: `packages/agent-runtime/src/responses-provider.ts`
- Modify: `packages/agent-runtime/src/pi-planning-provider.ts`
- Modify: `packages/agent-runtime/src/pi-travel-tools.ts`
- Modify: `packages/agent-runtime/src/tool-registry.ts`
- Create: `packages/agent-runtime/src/conversation-tools.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/capability-gateway/src/context.ts`
- Modify: `packages/capability-gateway/src/gateway.ts`
- Modify: `packages/capability-gateway/src/policy-checker.ts`
- Create: `packages/agent-runtime/test/conversation-first-runtime.test.ts`
- Modify: `packages/agent-runtime/test/responses-provider.test.ts`
- Modify: `packages/agent-runtime/test/tool-loop.test.ts`
- Modify: `packages/capability-gateway/test/gateway.test.ts`

**Interfaces:**
- Extends: `AgentContext`, `StructuredAgentOutput`, `AgentRunSnapshot`, `LlmTurnInput` with Conversation, PlanningContext, reasoning and proposal data.
- Produces: `PlanningContextToolPort`, `ConversationMapToolPort`, `CandidateQueryPort`, `createConversationPlanningTools`.
- Allows: Capability context with `conversationId` and no `tripId` for explicitly pre-Trip tools.
- Produces: `AgentRunPersistence.deleteConversation(conversationId)` so deletion never leaves earlier turns behind.
- Preserves: eight-round tool limit, output redaction, `store: false`, URL allowlist and no rule fallback.

- [ ] **Step 1: Write failing runtime tests for optional Trip scope**

Test a first message with `conversationId: 'conversation-1'`, no Trip and requested risk `prepare`. The fake real-provider transport emits an `update_planning_context` call, receives a tool result containing `tripId: 'trip-1'`, then emits `search_offers` and a final Proposal. Assert the same AgentRun ends with `tripId: 'trip-1'`, a reasoning summary and a proposal draft.

Also assert:

- a pre-Trip attempt to call `search_offers` is blocked, while `search_places`, `list_candidate_places` and `update_planning_context` are allowed;
- a legacy direct-Trip context with `tripId` and no `conversationId` still starts successfully;
- a context with neither identifier fails before any provider or tool call;
- deleting `conversation-1` removes every AgentRun for that Conversation, not only its latest run.

- [ ] **Step 2: Write failing provider protocol tests**

Extend the fake Responses payload to return:

```json
{
  "assistantMessage": "我先确认出行人数，再继续规划。",
  "planningContextPatch": { "destination": "杭州" },
  "reasoningSummary": "已识别目的地，仍缺少日期和人数。",
  "missingFields": ["startsAt", "endsAt", "travelerCount"],
  "toolCalls": [],
  "actionRequests": [],
  "planProposal": null
}
```

Assert the HTTP request still contains `store: false`, declares `update_planning_context`, `search_places` and `list_candidate_places`, and does not declare save-candidate, accept-proposal, booking or payment tools.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```text
pnpm --filter @travel/agent-runtime exec vitest run test/conversation-first-runtime.test.ts test/responses-provider.test.ts test/tool-loop.test.ts
pnpm --filter @travel/capability-gateway test
```

Expected: FAIL because Trip is required and the new output/tool contracts are absent.

- [ ] **Step 4: Extend the public Agent contracts**

Use optional Trip state without fake IDs:

```ts
export interface AgentContext {
  actorId?: string;
  conversationId?: string;
  tripId?: string;
  agentRunId: string;
  userMessage: string;
  currentTripVersion?: number;
  planningContext: PlanningContext;
  redactedOffers: NormalizedOffer[];
  requestedRisk?: RiskLevel;
}

export interface StructuredAgentOutput {
  assistantMessage: string;
  planningContextPatch: PlanningContextPatch | null;
  reasoningSummary?: string;
  missingFields: PlanningContextField[];
  toolCalls: Array<{ toolName: string; input: unknown }>;
  actionRequests: Array<{ kind: string; resourceId: string }>;
  planProposal: PlanProposalDraft | null;
}

export type ClientMessageId = string;
export const ClientMessageIdSchema = z.string().uuid();

export interface ConversationMessage {
  id: string;
  clientMessageId?: ClientMessageId; // required for user messages, absent for assistant messages
  role: ConversationRole;
  content: string;
  createdAt: string;
}
```

At runtime, reject an `AgentContext` when both `conversationId` and `tripId` are absent. Add optional `conversationId` plus optional `tripId`/`currentTripVersion` to `AgentRunSnapshot`, and add the required persistence method:

```ts
deleteConversation(conversationId: string): Promise<number> | number;
```

Update both Responses and Pi providers. A provider that omits required fields fails with `ModelProtocolError`; no values are guessed.

- [ ] **Step 5: Generalize CapabilityContext safely**

Add optional `conversationId` and optional `tripId`, then refine the schema so at least one is present. If tool input contains `tripId`, Gateway requires the same non-empty context Trip. Trip-owned tools continue to require version and owner facts. Pre-Trip tools validate Conversation ownership inside their application ports.

- [ ] **Step 6: Add Conversation planning tools**

Define these tool ports:

```ts
export interface PlanningContextToolPort {
  applyAndEnsureTrip(input: {
    sessionId: string;
    conversationId: string;
    currentTripId?: string;
    expectedContextVersion: number;
    patch: PlanningContextPatch;
  }): Promise<{ context: PlanningContext; trip?: { id: string; version: number; ownerId: string } }>;
}

export interface ConversationMapToolPort {
  searchPlaces(sessionId: string, conversationId: string, query: string): Promise<Place[]>;
}

export interface CandidateQueryPort {
  list(sessionId: string, conversationId: string): Promise<CandidatePlace[]>;
}
```

Register `update_planning_context` as `prepare`, and `search_places` plus `list_candidate_places` as `read`. Do not register candidate writes or proposal acceptance.

- [ ] **Step 7: Update the bounded orchestrator loop**

When `update_planning_context` returns a Trip, update the current AgentRun and subsequent model context before the next round. Publish only these safe event payloads:

```text
AgentTurnStarted: { turnId }
PlanningContextUpdated: { version, populatedFields, missingFields, tripCreated }
ReasoningSummaryUpdated: { summary }
ToolCallStarted: { toolName }
ToolCallCompleted: { toolName, source?, resultCount? }
ToolCallFailed: { toolName, code, retryable }
PlanProposalCreated: { proposalId?, itemCount, estimatedTotalCents }
AgentMessageCompleted: { messageId }
AgentTurnFailed: { retryable, code }
```

Never emit tool arguments, raw provider payloads, prompt text or credentials.

- [ ] **Step 8: Run package verification**

Run:

```text
pnpm --filter @travel/agent-runtime test
pnpm --filter @travel/capability-gateway test
pnpm --filter @travel/agent-runtime typecheck
pnpm --filter @travel/capability-gateway typecheck
pnpm --filter @travel/agent-runtime lint
pnpm --filter @travel/capability-gateway lint
```

Expected: all pass.

- [ ] **Step 9: Commit Task 3**

```text
git add packages/contracts/src/events.ts packages/contracts/src/conversation.ts packages/agent-runtime packages/capability-gateway
git commit -m "feat: make agent runtime conversation aware"
```

---

### Task 4: Shared NestJS Runtime, Cookie Identity and All-Message Agent Execution

**Files:**
- Create: `apps/api/src/modules/sessions/anonymous-session.module.ts`
- Move/Modify: `apps/api/src/modules/conversations/anonymous-session.ts`
- Create: `apps/api/src/modules/agent/planning-runtime.module.ts`
- Modify: `apps/api/src/modules/agent/agent.module.ts`
- Modify: `apps/api/src/modules/agent/agent.controller.ts`
- Modify: `apps/api/src/modules/agent/local-planning-agent.module.ts`
- Modify: `apps/api/src/modules/conversations/conversation.module.ts`
- Modify: `apps/api/src/modules/conversations/conversation.controller.ts`
- Modify: `apps/api/src/modules/conversations/conversation-event-store.ts`
- Modify: `apps/api/src/local-planning-app.module.ts`
- Modify: `packages/application/src/conversations/conversation-service.ts`
- Create: `packages/application/src/conversations/conversation-planning-coordinator.ts`
- Modify: `packages/application/test/conversation-service.test.ts`
- Create: `apps/api/test/conversation-first.e2e-spec.ts`
- Modify: `apps/api/test/local-planning-memory-mode.spec.ts`

**Interfaces:**
- Produces: global `AnonymousSessionModule` and request `anonymousSessionId`.
- Produces: shared `PLANNING_AGENT_RUN_STORE`, `PLANNING_GATEWAY`, `AGENT_ORCHESTRATOR` providers.
- Produces: `ConversationPlanningCoordinator.applyAndEnsureTrip` implementation for Task 3's tool port.
- Extends: message input with `clientMessageId` and guarantees one new real AgentRun for every distinct user message.
- Changes: direct AgentController start/get/resume ownership from `x-actor-id` to the same server-issued anonymous session cookie.
- Consumes: Tasks 1–3 services and contracts.

- [ ] **Step 1: Write the failing shared-runtime regression**

Create an API test with a fake HTTP transport behind `ThirdPartyResponsesProvider`, not `RuleBasedProvider`. Post two distinct messages:

```text
我想 10 月 1 日到 4 日去杭州
两个人，预算 5000 元，喜欢人文景点和本地餐馆
```

Assert:

- two distinct client message IDs produce at least two provider HTTP requests;
- neither assistant reply equals or contains the old fixed “已记下你的想法” text;
- the second turn shares the first turn's Conversation and PlanningContext;
- the context tool creates a Trip owned by the cookie session;
- a subsequent prepare tool creates a Proposal or plan-related result without `forbidden`/`policy_blocked`;
- the AgentRun returned through `/v1/agent/runs/:id` is the same run referenced by the Conversation.

- [ ] **Step 2: Write message idempotency tests**

Use UUID values such as `018f47f2-3a8a-7c71-9d2d-f114dfe66a01`. Assert same `clientMessageId` plus same content returns the saved turn without a second provider request, while the same ID with different content returns HTTP 409. Invalid/non-UUID IDs return HTTP 400. Concurrent distinct messages for one Conversation return 409 `conversation_turn_in_progress` rather than overlapping model runs.

- [ ] **Step 3: Run API and application tests and verify RED**

Run:

```text
pnpm --filter @travel/application exec vitest run test/conversation-service.test.ts
pnpm --filter @travel/api exec vitest run test/conversation-first.e2e-spec.ts test/local-planning-memory-mode.spec.ts
```

Expected: FAIL because ConversationModule owns an isolated orchestrator/store, messages lack idempotency IDs and prepare calls use the wrong owner/risk.

- [ ] **Step 4: Extract the reusable anonymous session module**

Move the provider and guard behind `AnonymousSessionModule`, export both, and keep `travel_session` as HttpOnly, SameSite=Lax, seven-day cookie. The guard no longer depends directly on ConversationService; expiry cleanup is invoked by a small `AnonymousSessionCleanupPort` so Trip/Map/Candidate/Proposal controllers can reuse it without a module cycle.

- [ ] **Step 5: Build one shared planning runtime module**

`PlanningRuntimeModule` owns exactly one Gateway, provider, AgentRun persistence object and PlanningOrchestrator. `AgentModule` and `ConversationModule` import and inject its exported tokens. `LocalPlanningAgentModule` becomes a thin controller wrapper or is removed if `AgentModule` can import the restricted runtime without importing booking modules.

Apply `AnonymousSessionGuard` to `AgentController`. For direct Trip runs, pass `actorId = anonymousSessionId` and preserve the Trip-only context; for Conversation-owned runs, pass both identifiers. Remove all reads of `x-actor-id` from start/get/resume and verify run ownership against the cookie session.

The runtime Gateway combines:

```ts
[
  ...createConversationPlanningTools(contextCoordinator, conversationMap, candidates),
  ...createPlanningTools(searchService, planService, planContextProvider),
]
```

Only `read` and `prepare` tools are present.

- [ ] **Step 6: Make ConversationService execute every distinct message**

Change input to:

```ts
export interface AppendConversationMessageInput {
  content: string;
  clientMessageId: ClientMessageId;
}
```

Persist `clientMessageId` only on the user `ConversationMessage`; assistant messages leave it absent. Every non-idempotent append calls `runner.run` with `actorId = sessionId`, `conversationId`, optional current Trip, full sanitized messages, `requestedRisk = 'prepare'` and the current PlanningContext. Start a new AgentRun for each message; do not resume a prior run as the new turn. Save the latest run ID and Trip ID back to the Conversation. Conversation deletion and expiry call `runs.deleteConversation(conversationId)` so all historical turns are removed.

- [ ] **Step 7: Publish and recover safe progress events**

Extend `ConversationTurnEvent.event_type` with the Task 3 event names. Keep `Last-Event-ID` validation, per-Conversation sequence and live subscribers. Assistant messages remain the authoritative completed replies; progress summaries do not masquerade as chat messages.

- [ ] **Step 8: Expand local-mode security coverage**

Update `local-planning-memory-mode.spec.ts` to append a real fake-transport message and verify shared plan access. Assert 404 for booking intents, orders, payment, traveler, vault, audit and supplier webhook routes.

- [ ] **Step 9: Run focused verification**

Run:

```text
pnpm --filter @travel/application exec vitest run test/conversation-service.test.ts
pnpm --filter @travel/api exec vitest run test/conversation-first.e2e-spec.ts test/conversation.e2e-spec.ts test/local-planning-memory-mode.spec.ts
pnpm --filter @travel/api typecheck
pnpm --filter @travel/api lint
```

Expected: all pass.

- [ ] **Step 10: Commit Task 4**

```text
git add apps/api/src/modules/sessions apps/api/src/modules/agent apps/api/src/modules/conversations apps/api/src/local-planning-app.module.ts apps/api/test/conversation-first.e2e-spec.ts apps/api/test/local-planning-memory-mode.spec.ts packages/application/src/conversations packages/application/test/conversation-service.test.ts
git commit -m "feat: share conversation planning runtime"
```

---

### Task 5: Conversation-Scoped Map, Candidate and Proposal APIs

**Files:**
- Modify: `apps/api/src/modules/map/map.controller.ts`
- Modify: `apps/api/src/modules/map/map.module.ts`
- Create: `apps/api/src/modules/candidates/candidate.controller.ts`
- Create: `apps/api/src/modules/candidates/candidate.module.ts`
- Create: `apps/api/src/modules/proposals/proposal.controller.ts`
- Create: `apps/api/src/modules/proposals/proposal.module.ts`
- Modify: `apps/api/src/modules/conversations/conversation.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/local-planning-app.module.ts`
- Create: `apps/api/test/conversation-map-candidate.e2e-spec.ts`
- Create: `apps/api/test/plan-proposal.e2e-spec.ts`
- Modify: `apps/api/test/map.e2e-spec.ts`

**Interfaces:**
- Produces: Conversation-scoped place search, route, candidate and proposal routes.
- Consumes: cookie identity, Conversation ownership, `MapService`, `CandidateService`, `PlanProposalService`.
- Preserves: `/v1/map/public-config` and `/_AMapService/*` security proxy.

- [ ] **Step 1: Write failing no-Trip map and candidate API tests**

Create a Conversation with no Trip, then verify:

```text
GET  /v1/conversations/{id}/places/search?query=西湖
POST /v1/conversations/{id}/candidates
GET  /v1/conversations/{id}/candidates
PATCH /v1/conversations/{id}/candidates/{candidateId}
DELETE /v1/conversations/{id}/candidates/{candidateId}
```

The search returns normalized GCJ-02 places. Adding one result returns 201, a refresh GET returns it, PATCH changes only `priority`/`note`, and DELETE removes only the owned candidate. A second cookie gets 403 or the project's non-disclosing ownership error. Missing/blank query returns 400. No request requires `x-actor-id`.

- [ ] **Step 2: Write failing proposal API tests**

Cover current, accept-place, accept-all, reject, idempotent replay and version conflict:

```text
GET  /v1/conversations/{id}/plan-proposals/current
POST /v1/conversations/{id}/plan-proposals/{proposalId}/places/{placeId}/accept
POST /v1/conversations/{id}/plan-proposals/{proposalId}/accept
POST /v1/conversations/{id}/plan-proposals/{proposalId}/reject
```

Assert no candidate exists before acceptance and accepted response includes the resulting PlanVersion.

- [ ] **Step 3: Run focused API tests and verify RED**

Run:

```text
pnpm --filter @travel/api exec vitest run test/conversation-map-candidate.e2e-spec.ts test/plan-proposal.e2e-spec.ts
```

Expected: 404 because Conversation-scoped routes do not exist.

- [ ] **Step 4: Implement Conversation-scoped MapController routes**

Use `AnonymousSessionGuard` and `ConversationService.get(sessionId, conversationId)` for ownership. Add:

```text
GET  v1/conversations/:conversationId/places/search
POST v1/conversations/:conversationId/routes
```

Do not require a Trip. When PlanningContext has a destination, pass it only as an AMap search hint; an explicit city in the user's query wins. Existing Trip-scoped routes may remain for compatibility but the Web client stops using them.

- [ ] **Step 5: Implement CandidateController**

Implement GET, POST, PATCH and DELETE. Validate bodies with strict Zod schemas. `POST` accepts a normalized `Place`, source `user_search`, optional note and priority. PATCH accepts only `note` and `priority`; it cannot change place identity or source. The controller does not accept `accepted_agent_proposal` from arbitrary clients; that source is created only by ProposalService.

- [ ] **Step 6: Implement ProposalController**

Require `Idempotency-Key` for accept-all. Require `expectedProposalVersion`, `expectedPlanningContextVersion` and `expectedPlanVersion`. Return 409 on stale state, 410 on expiry and the existing Chinese public error envelope.

- [ ] **Step 7: Run focused verification**

Run:

```text
pnpm --filter @travel/api exec vitest run test/conversation-map-candidate.e2e-spec.ts test/plan-proposal.e2e-spec.ts test/map.e2e-spec.ts
pnpm --filter @travel/api typecheck
pnpm --filter @travel/api lint
```

Expected: all pass and AMap server credentials never appear in responses.

- [ ] **Step 8: Commit Task 5**

```text
git add apps/api/src/modules/map apps/api/src/modules/candidates apps/api/src/modules/proposals apps/api/src/modules/conversations/conversation.module.ts apps/api/src/app.module.ts apps/api/src/local-planning-app.module.ts apps/api/test/conversation-map-candidate.e2e-spec.ts apps/api/test/plan-proposal.e2e-spec.ts apps/api/test/map.e2e-spec.ts
git commit -m "feat: expose conversation planning APIs"
```

---

### Task 6: PostgreSQL Persistence, Atomic Acceptance and Expiry Cleanup

**Files:**
- Create: `packages/persistence/src/migrations/016_conversation_first_planning.ts`
- Modify: `packages/persistence/src/migrations/runner.ts`
- Modify: `packages/persistence/src/types.ts`
- Modify: `packages/persistence/src/repositories/conversation-repository.ts`
- Modify: `packages/persistence/src/repositories/agent-run-repository.ts`
- Create: `packages/persistence/src/repositories/planning-context-repository.ts`
- Create: `packages/persistence/src/repositories/candidate-repository.ts`
- Create: `packages/persistence/src/repositories/plan-proposal-repository.ts`
- Create: `packages/persistence/src/repositories/proposal-acceptance-repository.ts`
- Modify: `packages/persistence/src/index.ts`
- Modify: `apps/api/src/modules/agent/planning-runtime.module.ts`
- Modify: `apps/api/src/modules/conversations/conversation.module.ts`
- Modify: `apps/api/src/modules/candidates/candidate.module.ts`
- Modify: `apps/api/src/modules/proposals/proposal.module.ts`
- Modify: `apps/worker/src/jobs/anonymous-session-cleanup-job.ts`
- Create: `packages/persistence/test/conversation-first-planning.integration.test.ts`
- Modify: `packages/persistence/test/migrations.test.ts`
- Modify: `apps/worker/test/anonymous-session-cleanup-job.test.ts`

**Interfaces:**
- Produces: PostgreSQL implementations for Tasks 1–2 repositories.
- Produces: transaction-backed proposal acceptance across Proposal, Candidate and PlanVersion rows.
- Changes: Agent runs have nullable `conversation_id`, nullable `trip_id`, nullable `current_trip_version`, with at least one scope identifier required.
- Changes: user Agent messages persist a nullable UUID `client_message_id`; assistant rows keep it null.
- Consumes: existing Kysely database and migration runner.

- [ ] **Step 1: Write failing migration and repository tests**

When `DATABASE_URL` is absent, the integration test prints one explicit skip gate. When present, verify:

- migration 016 up/down symmetry;
- PlanningContext optimistic updates;
- Conversation candidate uniqueness by provider place ID;
- proposal status/version transitions;
- replacement and time-based expiry of pending proposals;
- AgentRun persistence before a Trip exists;
- message `client_message_id` uniqueness per Conversation;
- one transaction writes accepted Proposal, CandidatePlace rows and one PlanVersion;
- a forced candidate insert failure rolls back proposal and plan writes;
- deleting/expiring the anonymous session cascades every new row and every AgentRun for its Conversation, including runs older than `conversation.agentRunId`.

- [ ] **Step 2: Run persistence tests and verify RED**

Run:

```text
pnpm --filter @travel/persistence exec vitest run test/migrations.test.ts test/conversation-first-planning.integration.test.ts
pnpm --filter @travel/worker exec vitest run test/anonymous-session-cleanup-job.test.ts
```

Expected: schema/repository symbols are missing.

- [ ] **Step 3: Implement migration 016**

Create:

```text
planning_contexts
candidate_places
plan_proposals
proposal_idempotency_keys
```

Add nullable `client_message_id varchar(36)` to `agent_messages` and a unique partial index on `(conversation_id, client_message_id)` where the ID is not null. Add nullable `conversation_id` to `agent_runs`, make `trip_id` and `current_trip_version` nullable, and add a check constraint requiring `conversation_id IS NOT NULL OR trip_id IS NOT NULL`. Conversation message execution always supplies `conversation_id`; existing direct Trip runs may leave it null. Add foreign keys to `agent_conversations` and indexes for Conversation lookup, proposal status/expiry and candidate ordering.

Use JSON text columns only for validated normalized objects; never store provider raw payloads or hidden reasoning.

- [ ] **Step 4: Implement repository adapters**

Each adapter implements the application interface exactly. Repositories verify session ownership in SQL rather than loading unowned rows and checking afterward. `ProposalAcceptanceRepository` uses one Kysely transaction to:

1. lock/read the pending proposal;
2. verify expected proposal/context/plan versions;
3. append one plan version and change set;
4. upsert accepted candidate places;
5. mark proposal accepted;
6. save the idempotent response hash and response snapshot.

- [ ] **Step 5: Wire storage by environment**

Local planning memory mode uses the in-memory repositories from Tasks 1–2 and one in-memory AgentRunStore. Test modules may inject explicit fakes. Ordinary development and production instantiate only PostgreSQL repositories and fail at startup when `DATABASE_URL` is absent.

- [ ] **Step 6: Extend cleanup**

The worker marks pending proposals with `expires_at <= now` as `expired`; service reads and acceptance perform the same check so correctness does not depend on worker timing. Deleting or expiring a Conversation calls repository-level `deleteConversation(conversationId)` and removes PlanningContext, candidates, proposals, every associated AgentRun, events and map records. Existing Trip-only AgentRuns and Trip/order data outside the anonymous planning session remain governed by their own retention rules.

- [ ] **Step 7: Run focused verification**

Run:

```text
pnpm --filter @travel/persistence exec vitest run test/migrations.test.ts test/conversation-first-planning.integration.test.ts
pnpm --filter @travel/worker exec vitest run test/anonymous-session-cleanup-job.test.ts
pnpm --filter @travel/persistence typecheck
pnpm --filter @travel/api typecheck
pnpm --filter @travel/worker typecheck
```

Expected: all configured tests pass; the PostgreSQL integration gate is explicit when no database is configured.

- [ ] **Step 8: Commit Task 6**

```text
git add packages/persistence apps/api/src/modules/agent/planning-runtime.module.ts apps/api/src/modules/conversations/conversation.module.ts apps/api/src/modules/candidates/candidate.module.ts apps/api/src/modules/proposals/proposal.module.ts apps/worker/src/jobs/anonymous-session-cleanup-job.ts apps/worker/test/anonymous-session-cleanup-job.test.ts
git commit -m "feat: persist conversation-first planning"
```

---

### Task 7: Conversation-First React Workspace

**Files:**
- Create: `apps/web/src/features/session/ConversationWorkspace.tsx`
- Create: `apps/web/src/features/session/PlanningContextChips.tsx`
- Create: `apps/web/src/features/map/PlaceSearch.tsx`
- Create: `apps/web/src/features/candidates/CandidatePlaceList.tsx`
- Create: `apps/web/src/features/proposals/PlanProposalCard.tsx`
- Create: `apps/web/src/features/agent/AgentProgress.tsx`
- Modify: `apps/web/src/features/chat/ChatPanel.tsx`
- Modify: `apps/web/src/features/chat/ChatMessage.tsx`
- Modify: `apps/web/src/features/map/TravelMap.tsx`
- Modify: `apps/web/src/routes/PlannerRoute.tsx`
- Modify: `apps/web/src/features/workspace/PlanningWorkspace.tsx`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/lib/sse-client.ts`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/routes/PlannerRoute.test.tsx`
- Modify: `apps/web/src/features/chat/ChatPanel.test.tsx`
- Modify: `apps/web/src/features/map/TravelMap.test.tsx`
- Create: `apps/web/src/features/session/ConversationWorkspace.test.tsx`
- Create: `apps/web/src/features/agent/AgentProgress.test.tsx`

**Interfaces:**
- Consumes: Task 5 cookie-owned APIs and Task 3 SSE events.
- Produces: one page shell that exists before and after Trip creation.
- Removes: client-generated actor ID, Trip creation form, disabled landing map search and fixed chat acknowledgment.

- [ ] **Step 1: Write failing route and workspace rendering tests**

Assert server-rendered markup contains Agent chat and enabled `搜索地点`, but not `精确编辑行程范围`, `planner-form`, destination/date inputs, empty itinerary card or budget card.

Test context chips with the literal labels `杭州`, `10月1日–10月4日`, `2 人`, `预算 ¥5000`. Missing fields are not rendered as invented values.

- [ ] **Step 2: Write failing ChatPanel and AgentProgress tests**

Assert ChatPanel never synthesizes a success reply. Its submit callback receives `{ content, clientMessageId }`; pending UI remains until the API/SSE supplies an assistant message. A failure renders `重试本轮` using the same client message ID.

Assert AgentProgress maps safe events to Chinese status text and does not render event payload keys matching `prompt`, `authorization`, `cookie`, `token`, `secret`, `raw`, or `reasoning_content`.

- [ ] **Step 3: Write failing map/candidate/proposal tests**

Assert PlaceSearch is enabled without Trip, a result card offers `加入候选`, and an Agent proposal result is not present in CandidatePlaceList before acceptance. Accepting the Proposal callback returns one PlanVersion and reveals itinerary/budget UI.

- [ ] **Step 4: Run focused Web tests and verify RED**

Run:

```text
pnpm --filter @travel/web exec vitest run src/routes/PlannerRoute.test.tsx src/features/chat/ChatPanel.test.tsx src/features/map/TravelMap.test.tsx src/features/session/ConversationWorkspace.test.tsx src/features/agent/AgentProgress.test.tsx
```

Expected: FAIL because the route still contains the form, map search is disabled and ChatPanel returns local text.

- [ ] **Step 5: Replace PlannerRoute with Conversation bootstrap**

On mount, restore the non-sensitive Conversation ID and call `GET`; if missing or expired, call `POST /v1/conversations`. Render `ConversationWorkspace` immediately. Do not create a Trip and do not generate `x-actor-id`.

- [ ] **Step 6: Make chat API/SSE authoritative**

`ChatPanel` appends the optimistic user bubble and a visible pending state, then calls the Conversation message API. It only renders an assistant bubble received from the API or `ConversationMessageCreated` SSE event. Every retry reuses `clientMessageId`; a new user submission creates a new UUID.

- [ ] **Step 7: Implement always-enabled map search and candidate actions**

PlaceSearch calls `/v1/conversations/{id}/places/search`. Display city and address on every result. `TravelMap` shows the returned GCJ-02 markers regardless of Trip state. Adding a result calls Candidate API and refreshes CandidatePlaceList.

- [ ] **Step 8: Implement Proposal and conditional plan UI**

Show `加入候选`, `忽略`, `接受行程` and `拒绝` only where the contract permits. Do not render itinerary or budget panels until Proposal acceptance returns a PlanVersion. The desktop plan panel is collapsible; mobile enables the `行程` tab only when a formal plan exists.

- [ ] **Step 9: Implement safe progress presentation**

Show the current progress step while running. After completion, collapse to `查看思考与执行过程`. Render model-provided `reasoningSummary` as a summary, never label it as raw chain-of-thought. Tool names use a fixed Chinese label map; unknown names display `规划工具` rather than internal identifiers.

- [ ] **Step 10: Run Web verification**

Run:

```text
pnpm --filter @travel/web test
pnpm --filter @travel/web typecheck
pnpm --filter @travel/web lint
pnpm --filter @travel/web build
```

Expected: all pass.

- [ ] **Step 11: Commit Task 7**

```text
git add apps/web/src/features/session apps/web/src/features/candidates apps/web/src/features/proposals apps/web/src/features/agent/AgentProgress.tsx apps/web/src/features/agent/AgentProgress.test.tsx apps/web/src/features/chat apps/web/src/features/map apps/web/src/routes/PlannerRoute.tsx apps/web/src/routes/PlannerRoute.test.tsx apps/web/src/features/workspace/PlanningWorkspace.tsx apps/web/src/lib apps/web/src/styles
git commit -m "feat: build conversation-first travel workspace"
```

---

### Task 8: Full Acceptance, Browser Regression and Live Smoke

**Files:**
- Modify: `packages/testkit/test/planning-workspace.test.ts`
- Modify: `apps/api/test/full-trip-flow.e2e-spec.ts`
- Rewrite: `apps/web/tests/full-trip-flow.spec.ts`
- Rewrite: `apps/web/tests/planner.spec.ts`
- Modify: `apps/web/playwright.config.ts`
- Create: `apps/api/scripts/conversation-first-live-smoke.mjs`
- Modify: `apps/api/package.json`
- Modify: `docs/runbooks/local-development.md`
- Modify: `docs/runbooks/release-checklist.md`
- Modify: `.env.example`

**Interfaces:**
- Exercises: every boundary from Conversation creation through accepted PlanVersion.
- Uses: explicit fake Responses and AMap transports in ordinary tests; real credentials only in gated live smoke.
- Verifies: no booking/payment UI or tools and no credential leakage.

- [ ] **Step 1: Write the failing application/API acceptance scenario**

Use the exact scenario:

1. Create an anonymous Conversation with no Trip.
2. Search `西湖` and save it as a user-search candidate.
3. Send `我想 10 月 1 日到 4 日去杭州`.
4. Verify the real-provider boundary replies with a missing-traveler question.
5. Send `两个人，预算 5000 元，喜欢人文景点和本地餐馆`.
6. Verify a Trip is automatically created for the same session.
7. Verify transport, stay, attraction and dining tools run through Gateway.
8. Verify a pending Proposal appears while candidates still contain only the manually saved place.
9. Accept the Proposal and verify one new PlanVersion plus accepted candidates.
10. Send `第二天轻松一点` and verify another real AgentRun and a new pending adjustment Proposal.
11. Refresh/reload services and verify recovery.
12. Delete the Conversation and verify its messages, context, candidates, proposals, events and pre-Trip runs are gone.

- [ ] **Step 2: Run API acceptance and verify RED**

Run:

```text
pnpm --filter @travel/testkit exec vitest run test/planning-workspace.test.ts
pnpm --filter @travel/api exec vitest run test/full-trip-flow.e2e-spec.ts
```

Expected: FAIL at the old Trip-first boundary.

- [ ] **Step 3: Rewrite Playwright around current UI semantics**

Install one stateful `page.route('**/api/**', handler)` fixture before navigation; it must implement every request used by the scenario and fail the test on any unhandled API request. Assert user-visible behavior rather than removed headings. The desktop and mobile projects must verify:

- no precise-edit form;
- map search enabled before Trip;
- candidate saved before Trip;
- two user messages produce two Agent turns and two distinct final replies;
- progress panel shows model/tool status;
- pending Proposal does not pre-populate candidates;
- accepting Proposal reveals itinerary and budget;
- no button or link matching `预订|下单|支付|退款|证件`;
- reload restores Conversation state;
- delete returns to a clean chat/map page.

- [ ] **Step 4: Make Playwright self-contained without PostgreSQL**

For fixture-routed UI E2E, configure `apps/web/playwright.config.ts` with only the Vite build/preview `webServer`. Do not start NestJS, PostgreSQL, the model provider or AMap Web Service. The Playwright route fixture owns Conversation, message, event, map, candidate and Proposal state in memory. Keep real API/provider execution in the gated live smoke and API acceptance suites.

- [ ] **Step 5: Add a gated real-provider/AMap smoke command**

Add `pnpm --filter @travel/api smoke:conversation-first`. The script exits with a clear missing-configuration result unless all required variables are present. When enabled, it prints only:

```text
model=configured|missing
amap_js=configured|missing
amap_web_service=success|failed
conversation=created|failed
turns_completed=<number>
trip_created=true|false
proposal_created=true|false
latency_ms=<number>
```

It never prints keys, Cookie values, raw prompts, raw model responses, provider response bodies or full user messages.

- [ ] **Step 6: Run focused acceptance**

Run:

```text
pnpm --filter @travel/testkit exec vitest run test/planning-workspace.test.ts
pnpm --filter @travel/api exec vitest run test/full-trip-flow.e2e-spec.ts
pnpm --filter @travel/web test:e2e -- full-trip-flow.spec.ts planner.spec.ts
pnpm security:scan-sensitive-output
```

Expected: all ordinary tests pass without consuming model or AMap quota.

- [ ] **Step 7: Run repository verification**

Run:

```text
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm security:scan-sensitive-output
```

Record any PostgreSQL-gated integration skip explicitly; do not call a skipped suite “passed”.

- [ ] **Step 8: Run the user-visible live scenario**

With the user's existing `.env` loaded and values never printed, start the API in explicit local planning memory mode and start Vite. Run the gated smoke command and then use the browser to complete the approved Hangzhou scenario. Verify the real model produces both assistant replies, the AMap JS canvas renders, the Web Service search status is reported accurately, and accepted Proposal state appears in the page.

- [ ] **Step 9: Commit Task 8**

```text
git add packages/testkit/test/planning-workspace.test.ts apps/api/test/full-trip-flow.e2e-spec.ts apps/web/tests/full-trip-flow.spec.ts apps/web/tests/planner.spec.ts apps/web/playwright.config.ts apps/api/scripts/conversation-first-live-smoke.mjs apps/api/package.json docs/runbooks/local-development.md docs/runbooks/release-checklist.md .env.example
git commit -m "test: verify conversation-first planning flow"
```

---

## Final Verification and Review

After all eight tasks have passed their task-specific independent reviews:

1. Generate one whole-branch review package from the merge base to HEAD.
2. Review all deferred Minor findings, especially stale legacy Web tests and any compatibility routes still using `x-actor-id`.
3. Dispatch one fix wave for all final Critical/Important findings, then one scoped re-review.
4. Run `verification-before-completion` using the exact full-suite and live-smoke evidence from Task 8.
5. Use `finishing-a-development-branch` to present merge, push or cleanup choices. Do not push or merge without the user's explicit instruction.
