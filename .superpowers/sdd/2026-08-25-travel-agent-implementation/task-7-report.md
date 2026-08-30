# Task 7 Implementation Report: Anonymous Planning Workspace

## Scope delivered

- Added a responsive React planning workspace with a desktop two-column layout and a mobile stacked layout with bottom navigation.
- Added typed API access for anonymous Trip creation, category search, Agent run summaries, itinerary reads, public error normalization, credentialed fetches, and abort signals.
- Added a typed SSE consumer that supports a `Last-Event-ID` cursor without persisting event data.
- Added offer comparison cards showing supplier, source update time, refund summary, and ranking-factor contributions.
- Added Agent activity, decisions/risk/status, budget thresholds, partial category failure, and itinerary conflict-warning surfaces.
- Added a Vite same-origin `/api` proxy for browser access to the test API and a Playwright configuration that starts the API in test mode plus the Web dev server.

## Privacy and scope constraints

- The anonymous actor is generated in memory only. The Web implementation does not call `localStorage` or `sessionStorage`.
- Traveler plaintext and booking payloads are not captured or stored by Web code. Agent output is rendered as API-provided summaries only.
- Booking and authentication flows are intentionally out of scope.

## TDD evidence

1. Added `apps/web/tests/planner.spec.ts` first.
2. The initial browser attempt loaded the smoke test but could not launch because the local Playwright Chromium executable was absent.
3. After configuring Playwright to use the installed Chrome channel, the smoke test passed in both the desktop and mobile projects.

## Verification

- `pnpm --filter @travel/web test:e2e -- planner.spec.ts` — 2 passed (desktop 1440x900; mobile 390x844), including a horizontal-overflow assertion.
- `pnpm --filter @travel/web lint` — passed.
- `pnpm --filter @travel/web typecheck` — passed.
- `pnpm --filter @travel/web build` — passed.
- `pnpm --filter @travel/contracts typecheck` — passed.
- `git diff --check` — passed.

## Notes

- The repository does not yet expose the future SSE event endpoint planned for Task 11, so the typed SSE client is ready for that endpoint but is not subscribed by this Task 7 route.
- Playwright uses `channel: 'chrome'` to use a locally installed stable browser rather than hard-coding a machine path or depending on the unavailable Playwright-managed Chromium download.

## Fix Round 1: Review Findings

### Changes

- Switched Playwright's Web server from Vite development mode to `build` plus `vite preview`, and configured the same `/api` proxy for both Vite development and preview modes.
- Added bounded, abortable SSE reconnects. The cursor is kept only in memory and updates from each received SSE event ID before the next request supplies it as `Last-Event-ID`.
- Added a truthful `供应商模式：Mock/Sandbox` workspace section. It states that anonymous users can compare Mock/Sandbox results but cannot book or pay from this workspace.
- Loaded the itinerary after search with a non-fatal failure path, so successful category results remain visible and real itinerary warnings reach `ItineraryList`.
- Passed the same in-memory anonymous actor ID to Agent-run creation as Trip creation, preserving owner binding.
- Added a Vitest configuration that scopes the unit runner to Web source tests rather than collecting Playwright specs.

### Covering Tests and Commands

Red phase:

- `pnpm --filter @travel/web test -- sse-client.test.ts`
  - Output: `expected "spy" to be called 2 times, but got 1 times`.
- `pnpm --filter @travel/web test:e2e -- planner.spec.ts`
  - Output: both desktop and mobile failed because `提醒：相邻安排的换乘时间较紧。` was absent.

Green phase:

- `pnpm --filter @travel/web test -- sse-client.test.ts`
  - Output: `1 passed`.
- `pnpm --filter @travel/web test:e2e -- planner.spec.ts`
  - Output: `2 passed` under the configuration that logs `vite build` and starts `vite preview`; desktop is 1440x900 and mobile is 390x844.
  - Browser assertions cover API-backed preview behavior, itinerary-warning rendering, Mock/Sandbox supplier mode, matching Trip/Agent anonymous actor headers, and no horizontal overflow.
- `pnpm --filter @travel/web test`
  - Output: `1 passed`.
- `pnpm --filter @travel/web lint`
  - Output: exit 0.
- `pnpm --filter @travel/web typecheck`
  - Output: exit 0.
- `pnpm --filter @travel/web build`
  - Output: Vite built 37 modules successfully.
- `git diff --check`
  - Output: exit 0.
