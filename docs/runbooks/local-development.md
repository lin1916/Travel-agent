# Local development

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to a local PostgreSQL database.
2. Run `pnpm install`, then `pnpm db:migrate`.
3. Start API, worker, vault, and web with `pnpm dev`.
4. Keep supplier webhook secrets and vault keys outside source control. Use opaque traveler references only.

The legacy runtime is the default. To opt into the Pi planning runtime, set `TRAVEL_AGENT_RUNTIME=pi` and configure `TRAVEL_LLM_API_KEY` plus the existing model settings. Pi uses the published npm packages `@earendil-works/pi-agent-core@0.84.4` and `@earendil-works/pi-ai@0.84.4`; Pi requires Node `>=22.19.0`. The local continuation was verified with Node `24.19.0` and pnpm `11.19.0`; Pi can now run on this toolchain. Both runtime paths use the configured real provider, not a fixed-response fallback.

Useful checks: `pnpm typecheck`, `pnpm test`, and `pnpm security:scan-sensitive-output`.

## Planning-only demo without PostgreSQL

The normal API remains durable and requires PostgreSQL. For a local, non-booking
demo only, start the API with explicit process-level overrides. These overrides
take precedence over `DATABASE_URL` in the existing `.env`; do not remove or
print any configured credentials.

```powershell
# Use Node 24 and pnpm 11.19.0 already available on PATH.
$env:NODE_ENV = 'development'
$env:LOCAL_PLANNING_MEMORY_MODE = 'true'
$env:DATABASE_URL = ' ' # Nonempty override; trimmed to empty by local-mode detection.
pnpm --filter @travel/api dev
```

In a second PowerShell window with Node 24 and pnpm on `PATH`, start the web application:

```powershell
pnpm --filter @travel/web dev
```

This root composition exposes health, trips, searches, itinerary, budget,
planning, conversations/SSE, agent runs, and map routes. It deliberately does
not register booking, payment, order, webhook, vault, or audit endpoints. The
configured model provider and AMap credentials are still used; supplier offer
searches remain the existing deterministic development adapters.

Memory mode retains conversations and accepted plans across browser refreshes only
while this API process is running. Restarting the API discards this temporary data;
use the normal PostgreSQL composition for persistence across restarts. A pending
proposal has a server-owned 24-hour review lifetime. Hotel stays reserve lodging
and can coexist with daytime activities; overlapping stays and overlapping timed
activities/transfers still fail validation.

## Pi endpoint smoke check

The Pi compatibility probe is a server-side, no-tool request. It is opt-in and
must run only with `TRAVEL_AGENT_RUNTIME=pi` and `TRAVEL_LLM_API_KEY` supplied
through the process environment. The outbound security policy accepts a timeout
from 1 to 30,000 milliseconds, so use `TRAVEL_LLM_TIMEOUT_MS=30000` or lower.

Run it from the API workspace after the agent-runtime package has been built:

```powershell
pnpm --filter @travel/agent-runtime build
pnpm --filter @travel/api exec tsx scripts/pi-live-smoke.ts
```

The command prints only `status`, latency, and model on success. A failure prints
only a stable redacted `errorCode`; it never prints the endpoint URL, headers,
API key, response body, or exception text. If the required runtime flag or key is
missing, it exits non-zero with `errorCode=missing_configuration`.

## Planning workspace smoke check

The live planning smoke check is opt-in and must run locally with credentials supplied only through the environment. It reports configuration state without printing values:

```powershell
node -e "for (const name of ['DATABASE_URL','TRAVEL_LLM_API_KEY','AMAP_WEB_SERVICE_KEY','AMAP_JS_KEY','AMAP_JS_SECURITY_CODE']) console.log(name + '=' + (process.env[name] ? 'configured' : 'missing')); console.log('model=' + (process.env.TRAVEL_LLM_MODEL || 'missing'))"
pnpm db:migrate
pnpm --filter @travel/testkit test -- planning-workspace.test.ts
```

Do not paste environment values into the terminal transcript. The live check should record only model name, latency, and a high-level pass/fail outcome; API keys and authorization headers must never be logged or sent to the browser.

## Conversation-first live smoke

After PostgreSQL migrations and the durable API are running, execute the gated smoke
from the repository root:

```powershell
$env:TRAVEL_SMOKE_API_URL = 'http://127.0.0.1:3000'
pnpm smoke:conversation-first
```

The check runs one AMap Web Service lookup, creates an anonymous Conversation, sends
two planning turns, and reads the current Proposal endpoint. It exits with code `2`
when `TRAVEL_LLM_API_KEY`, `AMAP_WEB_SERVICE_KEY`, or `AMAP_JS_KEY` is missing, and
prints only `configured`/`missing`, status values, counters, and latency. It never
prints keys, cookies, request bodies, provider responses, or exception text.

## Browser acceptance

The web Playwright suite runs against the production build and a fixture-backed
browser API, so it does not silently turn a missing database or model credential
into a passing browser test. Run it with:

```powershell
pnpm --filter @travel/web test:e2e
```

The fixture covers the Conversation-first entry, context chips, chat composer,
pre-Trip map search, candidate actions, Proposal review, formal-plan reveal, mobile
layout, and SSE reconnect behavior. Run the durable API and the live smoke separately
when real PostgreSQL, model, and AMap credentials are available.
