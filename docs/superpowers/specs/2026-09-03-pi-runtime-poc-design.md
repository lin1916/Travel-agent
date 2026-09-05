# Pi Runtime POC Design

**Date:** 2026-09-03

## Goal

Validate whether Pi can replace the generic Agent Loop and model transport inside TravelAgent without replacing the travel domain, security boundaries, API contract, or Web planning workspace.

## Decision

Use a hybrid runtime. TravelAgent remains the system of record for Trip, Plan, Budget, Conversation, AgentRun, TravelMandate, privacy grants, audit, and supplier interactions. Pi is introduced as a replaceable implementation behind the existing `LlmProvider`/planning boundary.

The first POC uses the published `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` packages at one pinned version. It does not copy the Pi repository into this project and does not fork Pi. A source checkout is only considered if a later requirement needs changes inside Pi itself.

## Runtime boundary

```text
API/BFF
  -> Travel planning application service
      -> Pi runtime adapter
          -> pi-agent-core Agent
          -> pi-ai OpenAI Responses provider
          -> allowlisted travel tools
              -> Capability Gateway
                  -> domain/application services
```

The adapter owns conversion between TravelAgent messages and Pi messages, redaction before model calls, event mapping, and final structured output. Pi tools are thin wrappers; they never call supplier adapters or persistence directly. Capability Gateway remains the only execution boundary for travel capabilities.

## POC scope

Included:

- Real model calls through the configured third-party OpenAI Responses-compatible endpoint.
- A Pi-backed read-only planning run.
- Travel planning tools: offer search, schedule check, and budget calculation.
- Existing version, mandate, privacy, and risk checks through Capability Gateway.
- Mapping Pi lifecycle events to existing AgentRun/SSE lifecycle events.
- Runtime selection through an explicit environment setting with legacy runtime rollback.
- Unit and integration tests using injected fake streams/providers; one opt-in live smoke command that never prints secrets.

Excluded:

- Payment, supplier order creation, redirects, cancellation, or refunds.
- Pi's coding tools such as file, edit, image, or shell tools.
- Persisting Pi's own JSONL session as the TravelAgent source of truth.
- Automatic fallback from a real Pi/model failure to `RuleBasedProvider`.
- Forking or vendoring Pi source.

## Model compatibility

The adapter must verify the configured endpoint before enabling Pi. It must preserve the existing environment names and never expose `TRAVEL_LLM_API_KEY` to the browser or logs. The endpoint path and OpenAI Responses features are probed explicitly because the current TravelAgent endpoint is configured as `/responses` rather than assuming a standard `/v1/responses` path.

## Failure and rollback

If Pi configuration is incomplete, incompatible, or fails at runtime, the request fails explicitly with a retryable model error. The API can be switched back to the existing runtime with the runtime environment setting; no hidden rule-based fallback is allowed. Booking/payment capabilities remain unavailable in the POC even if a model asks for them.

## Success criteria

1. A Pi-backed planning run returns the existing `StructuredAgentOutput` contract.
2. A tool request reaches Capability Gateway and cannot bypass its authorization, budget, privacy, or version checks.
3. Pi lifecycle events are emitted with the existing run and correlation identifiers.
4. Real endpoint smoke verification succeeds when valid secrets are present, without printing secret values.
5. Existing TravelAgent tests and the Web build remain green.
6. Removing or disabling the Pi runtime setting restores the existing provider path.
