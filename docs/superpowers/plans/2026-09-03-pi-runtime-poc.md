# Pi Runtime POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Pi-backed planning runtime that calls the real configured model and the existing Capability Gateway while preserving TravelAgent APIs, security rules, and rollback.

**Architecture:** Keep TravelAgent's domain, application, persistence, Capability Gateway, API, and Web layers as the authority. Add a Pi adapter inside `@travel/agent-runtime`; it converts the existing planning context to Pi messages/tools, maps Pi events back to existing lifecycle events, and delegates every travel action through Capability Gateway. The legacy runtime remains selectable until the POC has parity evidence.

**Tech Stack:** TypeScript, Node.js 22.19+, pnpm workspace, `@earendil-works/pi-agent-core@0.84.4`, `@earendil-works/pi-ai@0.84.4`, Zod, TypeBox, Vitest, NestJS, existing SSE/event stores.

**Spec:** `docs/superpowers/specs/2026-09-03-pi-runtime-poc-design.md`

## Global Constraints

- Use the published Pi packages; do not copy or fork the Pi repository for this POC.
- Pin both Pi packages to `0.84.4` and require Node `>=22.19.0` for the Pi runtime path.
- Real model calls remain mandatory in non-test mode; never silently fall back to `RuleBasedProvider`.
- Pi tools may call only Capability Gateway; they may not call suppliers, repositories, Vault, or payment code directly.
- Keep `TRAVEL_LLM_API_KEY`, Web Service keys, and Vault secrets server-side; never print or persist their values.
- POC tools are read-only planning tools only: `search_offers`, `check_schedule`, and `calculate_budget`.
- Do not enable booking, payment, redirect, cancellation, refund, traveler-data release, or supplier-order tools.
- Preserve the current `StructuredAgentOutput`, `AgentRunSnapshot`, request/correlation ID, trip-version, and SSE contracts.
- Pi failures are explicit retryable failures; no hidden rule-based fallback.
- Do not mix unrelated dirty files from the existing implementation worktree into the Pi commits.

---

### Task 1: Add Pi dependencies and runtime configuration

**Files:**
- Modify: `packages/agent-runtime/package.json`
- Modify: `package.json`
- Modify: `.env.example`
- Create: `packages/agent-runtime/src/runtime-config.ts`
- Test: `packages/agent-runtime/test/runtime-config.test.ts`
- Modify: `docs/runbooks/local-development.md`

**Interfaces:**
- Produces `AgentRuntimeMode = 'legacy' | 'pi'`.
- Produces `resolveAgentRuntimeConfig(environment: NodeJS.ProcessEnv): { mode: AgentRuntimeMode; piEnabled: boolean; model: string; baseUrl: string; responsesPath: string; apiKeyConfigured: boolean; nodeVersion: string }`.
- `mode` is `pi` only when `TRAVEL_AGENT_RUNTIME=pi`; unset or `legacy` uses the existing runtime.

- [ ] **Step 1: Write the failing tests**

```typescript
it('keeps legacy runtime as the default', () => {
  expect(resolveAgentRuntimeConfig({ NODE_ENV: 'development' }).mode).toBe('legacy');
});

it('enables Pi only with an explicit mode and configured model key', () => {
  expect(resolveAgentRuntimeConfig({
    NODE_ENV: 'development',
    TRAVEL_AGENT_RUNTIME: 'pi',
    TRAVEL_LLM_API_KEY: 'present',
    TRAVEL_LLM_BASE_URL: 'https://apizh-ai.com',
    TRAVEL_LLM_RESPONSES_PATH: '/responses',
    TRAVEL_LLM_MODEL: 'gpt-5.5',
  })).toMatchObject({ mode: 'pi', piEnabled: true, apiKeyConfigured: true });
});

it('rejects Pi mode in production when the model key is missing', () => {
  expect(() => resolveAgentRuntimeConfig({ NODE_ENV: 'production', TRAVEL_AGENT_RUNTIME: 'pi' }))
    .toThrow('Pi runtime requires a configured model API key');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/runtime-config.test.ts`

Expected: FAIL because `runtime-config.ts` and `resolveAgentRuntimeConfig` do not exist.

- [ ] **Step 3: Add pinned dependencies and minimal configuration resolver**

```json
{
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.84.4",
    "@earendil-works/pi-ai": "0.84.4"
  }
}
```

The resolver must trim values, preserve the existing defaults (`https://apizh-ai.com`, `/responses`, `gpt-5.5`), report only a boolean for key presence, and reject Pi mode in production without a key. It must not include the key in its returned object.

- [ ] **Step 4: Run the focused test and type checks**

Run: `pnpm install --lockfile-only`; then `pnpm --filter @travel/agent-runtime exec vitest run test/runtime-config.test.ts`; then `pnpm --filter @travel/agent-runtime typecheck`.

Expected: all resolver tests pass and typecheck exits 0. If the installed Node version is below `22.19.0`, record the exact version in the report and keep the Pi mode disabled until the toolchain is upgraded.

- [ ] **Step 5: Document local setup and commit**

Document `TRAVEL_AGENT_RUNTIME=pi`, Node `>=22.19.0`, and the fact that the published packages are installed from npm rather than copied into the repository. Commit with `feat: add opt-in pi runtime configuration`.

### Task 2: Implement the Pi model and travel-tool adapter

**Files:**
- Create: `packages/agent-runtime/src/pi-planning-provider.ts`
- Create: `packages/agent-runtime/src/pi-travel-tools.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/test/pi-planning-provider.test.ts`
- Test: `packages/agent-runtime/test/pi-travel-tools.test.ts`

**Interfaces:**
- Produces `PiPlanningProvider implements LlmProvider` with `generatePlan(input: LlmTurnInput): Promise<StructuredAgentOutput>`.
- Constructor accepts a `PiPlanningProviderOptions` object containing `models`, `model`, `streamFn`, `gateway`, `tools`, and an optional `onEvent` callback so tests can inject a deterministic Pi stream.
- Produces `createPiTravelTools(gateway: CapabilityGateway): AgentTool[]` with only `search_offers`, `check_schedule`, and `calculate_budget`.

- [ ] **Step 1: Write failing adapter tests**

```typescript
it('converts a Pi assistant response with no tools to StructuredAgentOutput', async () => {
  const provider = makePiProviderWithStream([{ type: 'text', text: 'A safe plan' }, { type: 'stop' }]);
  await expect(provider.generatePlan(input)).resolves.toMatchObject({
    assistantMessage: 'A safe plan', missingFields: [], toolCalls: [], actionRequests: [],
  });
});

it('routes a Pi travel tool through Capability Gateway', async () => {
  const calls: string[] = [];
  const gateway = makeGateway((name) => { calls.push(name); return { kind: 'attraction', offers: [] }; });
  const tool = createPiTravelTools(gateway).find(item => item.name === 'search_offers');
  await tool?.execute('tool-1', { kind: 'attraction', origin: '杭州', destination: '杭州', startsAt: '2026-09-10T00:00:00+08:00', endsAt: '2026-09-12T00:00:00+08:00', travelers: 2 });
  expect(calls).toEqual(['search_offers']);
});

it('does not expose payment or booking tools', () => {
  expect(createPiTravelTools(new CapabilityGateway()).map(tool => tool.name)).toEqual([
    'search_offers', 'check_schedule', 'calculate_budget',
  ]);
});
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/pi-planning-provider.test.ts test/pi-travel-tools.test.ts`

Expected: FAIL because the Pi adapter and tool factory do not exist.

- [ ] **Step 3: Implement the minimal Pi integration**

Use `Agent` from `@earendil-works/pi-agent-core` and `streamSimple`/`createProvider` from `@earendil-works/pi-ai` with the pinned `openai-responses` model. Convert only redacted TravelAgent messages into Pi user/assistant messages. Convert Pi text/tool results into the existing structured output. Set Pi tool execution to `parallel` for independent read-only searches, but preserve Gateway authorization and error results.

Each Pi tool must validate input before calling `gateway.execute`, build a `CapabilityContext` from the supplied run context, redact the returned details before exposing them to the model, and return a Pi `AgentToolResult`. Never include raw API keys, cookies, traveler documents, payment data, or supplier credentials in tool details.

- [ ] **Step 4: Run adapter tests, typecheck, and lint**

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/pi-planning-provider.test.ts test/pi-travel-tools.test.ts`; `pnpm --filter @travel/agent-runtime typecheck`; `pnpm --filter @travel/agent-runtime lint`.

Expected: focused tests pass with no type or lint errors.

- [ ] **Step 5: Commit**

Commit with `feat: add pi planning provider and governed travel tools`.

### Task 3: Wire Pi into the existing planning service and SSE mapping

**Files:**
- Modify: `packages/agent-runtime/src/planning-orchestrator.ts`
- Modify: `apps/api/src/modules/agent/agent.module.ts`
- Modify: `apps/api/src/modules/conversations/conversation.module.ts`
- Modify: `apps/api/src/modules/agent/agent.controller.ts`
- Modify: `apps/api/src/modules/conversations/conversation-event-store.ts`
- Test: `packages/agent-runtime/test/pi-runtime-wiring.test.ts`
- Test: `apps/api/test/pi-runtime.e2e-spec.ts`

**Interfaces:**
- Existing `PlanningOrchestrator.start`, `resume`, `get`, `AgentRunSnapshot`, and SSE route signatures remain unchanged.
- Adds `createPlanningRuntime(environment, dependencies)` returning the selected `LlmProvider` and the existing orchestrator dependencies.
- Pi event mapping emits existing lifecycle names: `ModelStarted`, `ModelCompleted`, `ToolStarted`, `ToolCompleted`, `ToolFailed`, and `AgentRunFailed`, preserving `runId` and correlation IDs.

- [ ] **Step 1: Write failing wiring tests**

```typescript
it('selects Pi only when TRAVEL_AGENT_RUNTIME=pi', () => {
  expect(createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'legacy' }, deps).provider)
    .toBeInstanceOf(ThirdPartyResponsesProvider);
  expect(createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'pi', TRAVEL_LLM_API_KEY: 'key' }, deps).provider)
    .toBeInstanceOf(PiPlanningProvider);
});

it('maps Pi lifecycle events to the existing planning event contract', async () => {
  const events: PlanningLifecycleEvent[] = [];
  const run = await makePiOrchestrator().start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou', onEvent: event => events.push(event) });
  expect(events.map(event => event.type)).toEqual(['ModelStarted', 'ModelCompleted']);
  expect(new Set(events.map(event => event.runId))).toEqual(new Set([run.runId]));
});
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/pi-runtime-wiring.test.ts`; `pnpm --filter @travel/api exec vitest run test/pi-runtime.e2e-spec.ts`.

Expected: FAIL because runtime selection and Pi event mapping are not wired.

- [ ] **Step 3: Wire the selected provider without changing public APIs**

Keep the current legacy provider path intact. When mode is `pi`, construct the Pi provider with the same `CapabilityGateway`, trip version reader, persistence, metrics, and event publisher used by the existing orchestrator. Do not add a second public controller route. Ensure API startup does not initialize Pi when legacy mode is selected.

- [ ] **Step 4: Run focused tests, typecheck, and build**

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/pi-runtime-wiring.test.ts`; `pnpm --filter @travel/api exec vitest run test/pi-runtime.e2e-spec.ts`; `pnpm --filter @travel/api typecheck`; `pnpm --filter @travel/api build`.

Expected: tests, typecheck, and build pass. The API test must verify that a booking/payment tool name is blocked and that the existing SSE event shape is unchanged.

- [ ] **Step 5: Commit**

Commit with `feat: wire pi runtime into planning workflow`.

### Task 4: Add endpoint compatibility probe and live smoke verification

**Files:**
- Create: `packages/agent-runtime/src/pi-endpoint-probe.ts`
- Modify: `packages/agent-runtime/src/pi-planning-provider.ts`
- Create: `packages/agent-runtime/test/pi-endpoint-probe.test.ts`
- Create: `apps/api/scripts/pi-live-smoke.ts`
- Modify: `.env.example`
- Modify: `docs/runbooks/local-development.md`

**Interfaces:**
- Produces `probePiEndpoint(config, fetchImpl): Promise<{ reachable: boolean; protocol: 'openai-responses'; model: string; errorCode?: string }>`.
- Produces a live smoke command that exits non-zero on missing configuration or model/protocol failure and prints only status, latency, model name, and redacted error code.

- [ ] **Step 1: Write failing probe tests**

```typescript
it('accepts a valid structured Responses payload without exposing response content', async () => {
  const result = await probePiEndpoint(config, fakeFetchReturningValidResponse());
  expect(result).toMatchObject({ reachable: true, protocol: 'openai-responses', model: 'gpt-5.5' });
  expect(JSON.stringify(result)).not.toMatch(/secret|passport|phone|authorization/i);
});

it('returns a stable error code for an unreachable endpoint', async () => {
  await expect(probePiEndpoint(config, async () => { throw new Error('network secret'); }))
    .resolves.toMatchObject({ reachable: false, errorCode: 'endpoint_unreachable' });
});
```

- [ ] **Step 2: Run the probe tests to verify RED**

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/pi-endpoint-probe.test.ts`

Expected: FAIL because the probe does not exist.

- [ ] **Step 3: Implement the probe and smoke command**

Use the same outbound allowlist and timeout policy as the existing model provider. Send a minimal no-tool structured planning request to the configured endpoint. Treat HTTP errors, invalid JSON, missing structured output, and timeout as explicit stable error codes. Never log request headers or response bodies.

- [ ] **Step 4: Run tests and, only when secrets are configured, the live smoke**

Run: `pnpm --filter @travel/agent-runtime exec vitest run test/pi-endpoint-probe.test.ts`; `pnpm --filter @travel/agent-runtime typecheck`; `pnpm --filter @travel/agent-runtime lint`.

When `TRAVEL_AGENT_RUNTIME=pi` and `TRAVEL_LLM_API_KEY` are configured, run: `pnpm --filter @travel/api exec tsx scripts/pi-live-smoke.ts`.

Expected: the fake probe tests pass. The live command either prints a successful status without secrets or fails with a stable redacted error; it must not silently select the rule provider.

- [ ] **Step 5: Commit**

Commit with `test: add pi endpoint compatibility smoke check`.

### Task 5: Regression, security scan, and documentation

**Files:**
- Modify: `packages/agent-runtime/test/responses-provider.test.ts`
- Modify: `apps/web/tests/full-trip-flow.spec.ts`
- Modify: `docs/runbooks/release-checklist.md`
- Create: `docs/runbooks/pi-runtime.md`

- [ ] **Step 1: Add regression assertions**

Add tests that legacy mode still uses the existing provider, Pi mode does not expose booking/payment tools, runtime errors are retryable and explicit, and browser/SSE payloads contain no model key, AMap service key, security code, passport, phone, or payment values.

- [ ] **Step 2: Run the complete verification set**

Run: `pnpm --filter @travel/agent-runtime test`; `pnpm --filter @travel/agent-runtime typecheck`; `pnpm --filter @travel/agent-runtime lint`; `pnpm --filter @travel/api typecheck`; `pnpm --filter @travel/api lint`; `pnpm --filter @travel/web typecheck`; `pnpm --filter @travel/web lint`; `pnpm security:scan-sensitive-output`.

Expected: all commands exit 0. If PostgreSQL or a browser is unavailable, report the exact blocked command and do not claim full-flow E2E coverage.

- [ ] **Step 3: Document operating the two runtime modes**

Document the npm dependency approach, Node requirement, environment variables, live smoke command, rollback to legacy mode, no-payment scope, and the fact that Pi's own session files are not the TravelAgent source of truth.

- [ ] **Step 4: Commit**

Commit with `docs: document pi runtime poc and rollback`.
