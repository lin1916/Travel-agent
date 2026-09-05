import { createAssistantMessageEventStream, type Context, type Model, type StreamFn } from '@earendil-works/pi-ai';
import { CapabilityGateway } from '@travel/capability-gateway';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { PiPlanningProvider } from '../src/pi-planning-provider.js';
import { createPlanningRuntime, PlanningOrchestrator, type PlanningLifecycleEvent } from '../src/planning-orchestrator.js';
import { ThirdPartyResponsesProvider, type ResponsesProviderConfig } from '../src/responses-provider.js';

const model = {
  id: 'gpt-5.5', name: 'GPT-5.5', api: 'openai-responses', provider: 'openai',
  input: ['text'], contextWindow: 128_000, maxTokens: 4_096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<any>;

function structuredOutput(assistantMessage: string): string {
  return JSON.stringify({ assistantMessage, planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null });
}

function completedStream(): StreamFn {
  return () => {
    const stream = createAssistantMessageEventStream();
    const message = {
      role: 'assistant' as const, api: 'openai-responses' as const, provider: 'openai' as const, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop' as const, timestamp: Date.now(), content: [{ type: 'text' as const, text: structuredOutput('Plan ready') }],
    };
    stream.push({ type: 'start', partial: { ...message, content: [] } });
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end();
    return stream;
  };
}

function dependencies() {
  const legacyConfig: ResponsesProviderConfig = {
    baseUrl: 'https://responses.example.test', responsesPath: '/responses', apiKey: 'legacy-key', model: 'gpt-5.5',
    reasoningEffort: 'xhigh', timeoutMs: 1_000, fetch: globalThis.fetch,
  };
  return {
    gateway: new CapabilityGateway(),
    legacyProvider: new ThirdPartyResponsesProvider(legacyConfig),
    pi: { models: {} as never, model, streamFn: completedStream(), tools: [] },
  };
}

function withNodeVersion<T>(version: string, callback: () => T): T {
  const original = process.version;
  Object.defineProperty(process, 'version', { configurable: true, value: version });
  try { return callback(); } finally { Object.defineProperty(process, 'version', { configurable: true, value: original }); }
}

describe('Pi planning runtime wiring', () => {
  it('selects Pi only when TRAVEL_AGENT_RUNTIME=pi', () => {
    expect(createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'legacy' }, dependencies()).provider)
      .toBeInstanceOf(ThirdPartyResponsesProvider);
    withNodeVersion('v22.19.0', () => {
      expect(createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'pi', TRAVEL_LLM_API_KEY: 'key' }, dependencies()).provider)
        .toBeInstanceOf(PiPlanningProvider);
    });
  });

  it('fails explicitly when Pi is requested on an unsupported Node runtime', () => {
    withNodeVersion('v22.16.0', () => {
      expect(() => createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'pi', TRAVEL_LLM_API_KEY: 'key' }, dependencies()))
        .toThrow('Pi runtime is unavailable on the current Node.js version');
    });
  });

  it('fails explicitly for an unknown configured Pi model', () => {
    withNodeVersion('v22.19.0', () => {
      expect(() => createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'pi', TRAVEL_LLM_API_KEY: 'key', TRAVEL_LLM_MODEL: 'does-not-exist' }, dependencies()))
        .toThrow('Pi model does-not-exist is unavailable');
    });
  });

  it('does not allow runtime dependencies to replace the governed Pi tool set', () => {
    withNodeVersion('v22.19.0', () => {
      const runtime = createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'pi', TRAVEL_LLM_API_KEY: 'key' }, {
        ...dependencies(),
        pi: { ...dependencies().pi, tools: [{ name: 'booking', label: 'Booking' } as never] },
      });
      const configuredTools = (runtime.provider as unknown as { options: { toolFactory: (context: { tripId: string }) => Array<{ name: string }> } }).options.toolFactory({ tripId: 'trip-1' });
      expect(configuredTools.map(tool => tool.name)).toEqual(['update_planning_context', 'search_places', 'list_candidate_places', 'search_offers', 'check_schedule', 'calculate_budget']);
    });
  });

  it('binds governed Pi tools to the current run context', async () => {
    await withNodeVersion('v22.19.0', async () => {
      let seenContext: { actorId: string; tripId: string; agentRunId: string; correlationId: string; requestedRisk?: string; actorAuthenticated?: boolean; currentTripVersion?: number; expectedTripVersion?: number } | undefined;
      let seenToolNames: string[] = [];
      let calls = 0;
      const gateway = new CapabilityGateway();
      gateway.register({
        name: 'search_offers', risk: 'read',
        inputSchema: z.object({ tripId: z.string(), kind: z.string(), destination: z.string(), startsAt: z.string(), travelers: z.number() }),
        execute: async (context) => { seenContext = context; return { offers: [] }; },
      });
      const streamFn: StreamFn = (_model, context: Context) => {
        seenToolNames = (context.tools ?? []).map(tool => tool.name);
        const stream = createAssistantMessageEventStream();
        const base = {
          role: 'assistant' as const, api: 'openai-responses' as const, provider: 'openai' as const, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          timestamp: Date.now(),
        };
        const message = calls++ === 0
          ? { ...base, stopReason: 'toolUse' as const, content: [{ type: 'toolCall' as const, id: 'call-1', name: 'search_offers', arguments: { tripId: 'trip-1', kind: 'attraction', destination: 'Hangzhou', startsAt: '2026-09-10T00:00:00+08:00', travelers: 2 } }] }
          : { ...base, stopReason: 'stop' as const, content: [{ type: 'text' as const, text: structuredOutput('Plan ready') }] };
        stream.push({ type: 'start', partial: { ...message, content: [] } });
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
        return stream;
      };
      const deps = dependencies();
      const runtime = createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'pi', TRAVEL_LLM_API_KEY: 'key' }, {
        gateway,
        legacyProvider: deps.legacyProvider,
        pi: { ...deps.pi, streamFn, tools: [{ name: 'booking', label: 'Booking' } as never] },
      });
      const run = await new PlanningOrchestrator(runtime.provider, runtime.gateway).start({
        tripId: 'trip-1', actorId: 'actor-1', userMessage: 'Plan Hangzhou', correlationId: 'correlation-1',
      });

      expect(run.status).toBe('completed');
      expect(seenToolNames).toEqual(['update_planning_context', 'search_places', 'list_candidate_places', 'search_offers', 'check_schedule', 'calculate_budget']);
      expect(seenToolNames).not.toContain('booking');
      expect(seenToolNames).not.toContain('payment');
      expect(seenContext).toMatchObject({ actorId: 'actor-1', tripId: 'trip-1', agentRunId: run.runId, correlationId: 'correlation-1', requestedRisk: 'read', actorAuthenticated: true, currentTripVersion: 1, expectedTripVersion: 1 });
    });
  });

  it('maps Pi lifecycle events to the existing planning event contract', async () => {
    await withNodeVersion('v22.19.0', async () => {
      const runtime = createPlanningRuntime({ NODE_ENV: 'development', TRAVEL_AGENT_RUNTIME: 'pi', TRAVEL_LLM_API_KEY: 'key' }, dependencies());
      const events: PlanningLifecycleEvent[] = [];
      const run = await new PlanningOrchestrator(runtime.provider, runtime.gateway).start({
        tripId: 'trip-1', userMessage: 'Plan Hangzhou', correlationId: 'correlation-1', onEvent: event => events.push(event),
      });

      expect(events.map(event => event.type)).toEqual(['AgentTurnStarted', 'AgentMessageCompleted']);
      expect(new Set(events.map(event => event.runId))).toEqual(new Set([run.runId]));
      expect(new Set(events.map(event => event.correlationId))).toEqual(new Set(['correlation-1']));
    });
  });

  it('maps a Pi tool failure event to ToolStarted and ToolFailed', async () => {
    const provider = {
      generatePlan: async (input: { onEvent?: (event: unknown) => Promise<void> | void }) => {
        await input.onEvent?.({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'search_offers' });
        await input.onEvent?.({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'search_offers', isError: true });
        return { assistantMessage: 'Unable to search', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null };
      },
    };
    const events: PlanningLifecycleEvent[] = [];
    const run = await new PlanningOrchestrator(provider, new CapabilityGateway()).start({
      tripId: 'trip-1', userMessage: 'Plan Hangzhou', correlationId: 'correlation-1', onEvent: event => events.push(event),
    });

    expect(run.status).toBe('completed');
    expect(events.map(event => event.type)).toEqual(['AgentTurnStarted', 'ToolCallStarted', 'ToolCallFailed', 'AgentMessageCompleted']);
    expect(events.filter(event => event.type === 'ToolCallFailed')[0]).toMatchObject({
      runId: run.runId, correlationId: 'correlation-1:tool-1', payload: { toolName: 'search_offers', code: 'pi_tool_failed', retryable: false },
    });
  });
});
