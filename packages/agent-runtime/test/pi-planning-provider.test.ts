import { describe, expect, it } from 'vitest';
import { createAssistantMessageEventStream, Type, type Context, type Model } from '@earendil-works/pi-ai';
import type { AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import { CapabilityGateway } from '@travel/capability-gateway';
import type { LlmTurnInput } from '../src/llm-provider.js';
import { PiPlanningProvider } from '../src/pi-planning-provider.js';
import { ModelProtocolError } from '../src/responses-provider.js';
import { buildBaseOptions } from '@earendil-works/pi-ai/api/simple-options';

const model = {
  id: 'gpt-5.5', name: 'gpt-5.5', api: 'openai-responses', provider: 'openai', baseUrl: 'https://example.invalid',
  reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
} as Model<'openai-responses'>;

const input: LlmTurnInput = {
  actorId: 'actor-1', requestId: 'request-1', correlationId: 'correlation-1', tripId: 'trip-1', agentRunId: 'run-1',
  userMessage: 'Plan a safe trip', currentTripVersion: 3,
  planningContext: { conversationId: 'conversation-1', version: 1, preferences: [], assumptions: [], missingFields: [], updatedAt: '2026-09-03T00:00:00.000Z' },
  redactedOffers: [], requestedRisk: 'read', messages: [{ role: 'user', content: 'Plan a safe trip' }], toolResults: [],
};

function structuredOutput(assistantMessage: string): string {
  return JSON.stringify({ assistantMessage, planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null });
}

function makePiProviderWithStream(events: Array<{ type: 'text'; text: string } | { type: 'stop' }>): PiPlanningProvider {
  const streamFn: StreamFn = () => {
    const stream = createAssistantMessageEventStream();
    const base = { role: 'assistant' as const, api: 'openai-responses' as const, provider: 'openai' as const, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'pending' as const, timestamp: Date.now() };
    const text = events.filter((event): event is { type: 'text'; text: string } => event.type === 'text').map(event => event.text).join('');
    stream.push({ type: 'start', partial: { ...base, content: [] } });
    if (text) stream.push({ type: 'text_start', contentIndex: 0, partial: { ...base, content: [{ type: 'text', text: '' }] } });
    if (text) stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: { ...base, content: [{ type: 'text', text }] } });
    if (text) stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: { ...base, content: [{ type: 'text', text }] } });
    stream.push({ type: 'done', reason: 'stop', message: { ...base, content: text ? [{ type: 'text', text }] : [], stopReason: 'stop' } });
    stream.end();
    return stream;
  };
  return new PiPlanningProvider({ models: {} as never, model, streamFn, gateway: new CapabilityGateway(), tools: [] });
}

function makePiProviderWithError(): PiPlanningProvider {
  const streamFn: StreamFn = () => {
    const stream = createAssistantMessageEventStream();
    const message = {
      role: 'assistant' as const,
      api: 'openai-responses' as const,
      provider: 'openai' as const,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'error' as const,
      errorMessage: 'upstream secret',
      timestamp: Date.now(),
      content: [],
    };
    stream.push({ type: 'start', partial: { ...message, stopReason: 'pending' } });
    stream.push({ type: 'error', reason: 'error', error: message });
    stream.end();
    return stream;
  };
  return new PiPlanningProvider({ models: {} as never, model, streamFn, gateway: new CapabilityGateway(), tools: [] });
}

describe('PiPlanningProvider', () => {
  it('converts a Pi assistant response with no tools to StructuredAgentOutput', async () => {
    const provider = makePiProviderWithStream([{ type: 'text', text: structuredOutput('A safe plan') }, { type: 'stop' }]);
    await expect(provider.generatePlan(input)).resolves.toMatchObject({
      assistantMessage: 'A safe plan', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null,
    });
  });

  it('rejects a Pi response that omits required structured fields', async () => {
    await expect(makePiProviderWithStream([{ type: 'text', text: 'A safe plan' }]).generatePlan(input)).rejects.toBeInstanceOf(ModelProtocolError);
  });

  it('normalizes nullable structured fields from the model before validation', async () => {
    const text = JSON.stringify({ assistantMessage: '请问几个人出行？', planningContextPatch: { destination: '杭州', origin: null }, reasoningSummary: null, missingFields: ['travelerCount'], toolCalls: [], actionRequests: [], planProposal: null });
    await expect(makePiProviderWithStream([{ type: 'text', text }]).generatePlan(input)).resolves.toMatchObject({
      assistantMessage: '请问几个人出行？', planningContextPatch: { destination: '杭州' }, missingFields: ['travelerCount'],
    });
  });

  it('throws an explicit retryable error when the Pi stream fails', async () => {
    await expect(makePiProviderWithError().generatePlan(input)).rejects.toThrow('Pi model request failed');
  });

  it('passes the redacted planning context to the Pi model', async () => {
    let seen: Context | undefined;
    const streamFn: StreamFn = (_model, context) => {
      seen = context;
      const stream = createAssistantMessageEventStream();
      const base = { role: 'assistant' as const, api: 'openai-responses' as const, provider: 'openai' as const, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop' as const, timestamp: Date.now() };
      stream.push({ type: 'start', partial: { ...base, content: [] } });
      stream.push({ type: 'done', reason: 'stop', message: { ...base, content: [{ type: 'text', text: structuredOutput('safe') }] } });
      stream.end();
      return stream;
    };
    const provider = new PiPlanningProvider({ models: {} as never, model, streamFn, gateway: new CapabilityGateway(), tools: [] });
    await provider.generatePlan({
      ...input,
      userMessage: 'Plan with passport ABC123',
      messages: [{ role: 'user', content: '杭州旅行' }, { role: 'assistant', content: '请问几个人出行？' }, { role: 'user', content: 'Plan with passport ABC123' }],
      redactedOffers: [{ supplierCredentials: 'secret', title: 'Hangzhou' }],
    });
    const serialized = JSON.stringify(seen);
    const outputSchema = JSON.parse(seen!.systemPrompt!.split('OUTPUT_SCHEMA\n')[1]!);
    expect(outputSchema.required).toEqual(['assistantMessage', 'planningContextPatch', 'reasoningSummary', 'missingFields', 'toolCalls', 'actionRequests', 'planProposal']);
    expect(outputSchema.properties.planProposal.anyOf[0].properties).toHaveProperty('planningContextVersion');
    expect(() => buildBaseOptions(model, seen!)).not.toThrow();
    expect(serialized).toContain('trip-1');
    expect(serialized).toContain('currentTripVersion');
    expect(serialized).toContain('requestedRisk');
    expect(serialized).not.toContain('ABC123');
    expect(serialized).not.toContain('secret');
  });

  it('uses models.streamSimple when no stream function is injected', async () => {
    let called = false;
    const streamFn: StreamFn = () => {
      const stream = createAssistantMessageEventStream();
      const base = { role: 'assistant' as const, api: 'openai-responses' as const, provider: 'openai' as const, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop' as const, timestamp: Date.now() };
      stream.push({ type: 'start', partial: { ...base, content: [] } });
      stream.push({ type: 'done', reason: 'stop', message: { ...base, content: [{ type: 'text', text: structuredOutput('fallback') }] } });
      stream.end();
      return stream;
    };
    const provider = new PiPlanningProvider({ models: { streamSimple: (...args: Parameters<StreamFn>) => { called = true; return streamFn(...args); } } as never, model, gateway: new CapabilityGateway(), tools: [] });
    await expect(provider.generatePlan(input)).resolves.toMatchObject({ assistantMessage: 'fallback' });
    expect(called).toBe(true);
  });

  it('uses a directly injected custom tool when no tool factory is configured', async () => {
    let toolCalls = 0;
    let streamCalls = 0;
    const customTool: AgentTool = {
      name: 'custom_planning_tool',
      label: 'Custom planning tool',
      description: 'A custom planning tool for direct provider consumers.',
      parameters: Type.Object({ query: Type.String() }),
      execute: async () => {
        toolCalls += 1;
        return { content: [{ type: 'text', text: 'custom result' }], details: { ok: true } };
      },
    };
    const streamFn: StreamFn = () => {
      const stream = createAssistantMessageEventStream();
      const base = {
        role: 'assistant' as const,
        api: 'openai-responses' as const,
        provider: 'openai' as const,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: Date.now(),
      };
      const message = streamCalls++ === 0
        ? {
          ...base,
          stopReason: 'toolUse' as const,
          content: [{ type: 'toolCall' as const, id: 'custom-call-1', name: 'custom_planning_tool', arguments: { query: 'Hangzhou' } }],
        }
        : {
          ...base,
          stopReason: 'stop' as const,
          content: [{ type: 'text' as const, text: structuredOutput('Custom plan ready') }],
        };
      stream.push({ type: 'start', partial: { ...message, content: [] } });
      stream.push({ type: 'done', reason: message.stopReason, message });
      stream.end();
      return stream;
    };
    const provider = new PiPlanningProvider({
      models: {} as never,
      model,
      streamFn,
      gateway: new CapabilityGateway(),
      tools: [customTool],
    });

    await expect(provider.generatePlan(input)).resolves.toMatchObject({ assistantMessage: 'Custom plan ready' });
    expect(toolCalls).toBe(1);
  });
});
