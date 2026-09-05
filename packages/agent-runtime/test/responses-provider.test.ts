import { describe, expect, it } from 'vitest';
import {
  createPlanningProvider,
  ModelConfigurationError,
  ModelProtocolError,
  ModelRequestError,
  ThirdPartyResponsesProvider,
} from '../src/responses-provider.js';
import type { AgentContext } from '@travel/contracts';

const context: AgentContext = {
  actorId: 'anonymous-session-1',
  requestId: 'request-1',
  correlationId: 'correlation-1',
  tripId: 'trip-1',
  agentRunId: 'run-1',
  userMessage: '计划 2026-10-01 到 2026-10-04 去杭州，2 人，预算 5000 元',
  currentTripVersion: 3,
  planningContext: {
    conversationId: 'conversation-1', version: 1, destination: '杭州', preferences: [], assumptions: [],
    missingFields: ['startsAt', 'endsAt', 'travelerCount'], updatedAt: '2026-09-03T00:00:00.000Z',
  },
  redactedOffers: [],
  requestedRisk: 'read',
};

function responseWith(output: unknown): Response {
  return new Response(JSON.stringify({
    id: 'resp-1',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(output) }],
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('ThirdPartyResponsesProvider', () => {
  it('sends a non-stored strict Responses request and returns structured planning output', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return responseWith({
        assistantMessage: '我先确认出行人数，再继续规划。',
        planningContextPatch: { destination: '杭州' },
        reasoningSummary: '已识别目的地，仍缺少日期和人数。',
        missingFields: ['startsAt', 'endsAt', 'travelerCount'],
        toolCalls: [],
        actionRequests: [],
        planProposal: null,
      });
    };
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com/',
      responsesPath: '/v1/planning-responses',
      apiKey: 'test-only-key',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      timeoutMs: 5_000,
      fetch: fetcher,
    });

    const result = await provider.generatePlan(context);

    expect(result).toMatchObject({
      assistantMessage: '我先确认出行人数，再继续规划。',
      planningContextPatch: { destination: '杭州' },
      reasoningSummary: '已识别目的地，仍缺少日期和人数。',
      missingFields: ['startsAt', 'endsAt', 'travelerCount'],
      planProposal: null,
    });
    expect(requestUrl).toBe('https://apizh-ai.com/v1/planning-responses');
    expect(new Headers(requestInit?.headers).get('authorization')).toBe('Bearer test-only-key');
    const body = JSON.parse(String(requestInit?.body)) as Record<string, any>;
    expect(body).toMatchObject({ model: 'gpt-5.5', store: false, reasoning: { effort: 'xhigh' } });
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'travel_planning_output', strict: true });
    expect(body.text.format.schema).toMatchObject({ additionalProperties: false });
    expect(body.text.format.schema.required).toContain('reasoningSummary');
    expect(body.text.format.schema.properties.planProposal.anyOf[0]).toMatchObject({ additionalProperties: false });
    expect(body.text.format.schema.properties.toolCalls.items.properties.input).toMatchObject({ additionalProperties: false });
    expect(JSON.stringify(body)).toContain(context.userMessage);
    expect(JSON.stringify(body)).not.toContain('test-only-key');
  });

  it('normalizes nullable strict-schema placeholders before contract validation', async () => {
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com', responsesPath: '/responses', apiKey: 'test-only-key', model: 'gpt-5.5', reasoningEffort: 'high', timeoutMs: 5_000,
      fetch: async () => responseWith({
        assistantMessage: '已识别目的地。', reasoningSummary: null,
        planningContextPatch: {
          destination: '杭州', origin: null, startsAt: null, endsAt: null,
          travelerCount: null, totalBudgetCents: null, preferences: null, assumptions: null,
        },
        missingFields: ['startsAt', 'endsAt', 'travelerCount'], toolCalls: [], actionRequests: [], planProposal: null,
      }),
    });

    await expect(provider.generatePlan({ ...context, conversationId: 'conversation-1' })).resolves.toEqual({
      assistantMessage: '已识别目的地。', planningContextPatch: { destination: '杭州' },
      missingFields: ['startsAt', 'endsAt', 'travelerCount'], toolCalls: [], actionRequests: [], planProposal: null,
    });
  });

  it('declares only read and prepare planning tools to the real model', async () => {
    let requestBody = '';
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com',
      responsesPath: '/responses',
      apiKey: 'test-only-key',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      timeoutMs: 5_000,
      fetch: async (_input, init) => {
        requestBody = String(init?.body);
        return responseWith({ assistantMessage: 'ok', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null });
      },
    });

    await provider.generatePlan({ ...context, conversationId: undefined });

    const body = JSON.parse(requestBody) as { input: Array<{ content: Array<{ text: string }> }> };
    const systemText = body.input[0]?.content[0]?.text ?? '';
    for (const toolName of [
      'update_planning_context', 'search_places', 'list_candidate_places',
      'search_offers', 'add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item',
      'replace_itinerary_item', 'lock_itinerary_item', 'optimize_day', 'check_schedule',
      'calculate_budget', 'undo_plan_change',
    ]) expect(systemText).toContain(toolName);
    expect(systemText).not.toContain('prepare_itinerary');
    const declaredTools = systemText.match(/Use only these read and prepare planning tool names: ([^.]+)\./)?.[1] ?? '';
    expect(declaredTools).not.toMatch(/save_candidate|accept_proposal|booking|payment/);
    const directSchema = JSON.parse(requestBody) as { text: { format: { schema: { properties: { toolCalls: { items: { properties: { toolName: { enum: string[] } } } } } } } } };
    expect(directSchema.text.format.schema.properties.toolCalls.items.properties.toolName.enum).toContain('add_itinerary_item');
  });

  it('limits Conversation prompts to proposal-safe tools', async () => {
    let requestBody = '';
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com', responsesPath: '/responses', apiKey: 'test-only-key', model: 'gpt-5.5', reasoningEffort: 'high', timeoutMs: 5_000,
      fetch: async (_input, init) => {
        requestBody = String(init?.body);
        return responseWith({ assistantMessage: 'ok', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null });
      },
    });

    await provider.generatePlan({ ...context, conversationId: 'conversation-1' });

    const body = JSON.parse(requestBody) as { input: Array<{ content: Array<{ text: string }> }> };
    const systemText = body.input[0]?.content[0]?.text ?? '';
    expect(systemText).toContain('update_planning_context, search_places, list_candidate_places, search_offers');
    expect(systemText).toContain('Return itinerary changes only in planProposal');
    const conversationSchema = JSON.parse(requestBody) as { text: { format: { schema: { properties: { toolCalls: { items: { properties: { toolName: { enum: string[] } } } } } } } } };
    expect(conversationSchema.text.format.schema.properties.toolCalls.items.properties.toolName.enum).toEqual([
      'update_planning_context', 'search_places', 'list_candidate_places', 'search_offers',
    ]);
  });
  it('declares PlanningContext timestamps as China Standard Time in the Responses schema', async () => {
    let requestBody = '';
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com', responsesPath: '/responses', apiKey: 'test-only-key', model: 'gpt-5.5', reasoningEffort: 'high', timeoutMs: 5_000,
      fetch: async (_input, init) => {
        requestBody = String(init?.body);
        return responseWith({ assistantMessage: 'ok', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null });
      },
    });

    await provider.generatePlan(context);

    const body = JSON.parse(requestBody) as { text: { format: { schema: { properties: { planningContextPatch: { anyOf: Array<{ properties?: Record<string, { pattern?: string }> }> } } } } } };
    const patch = body.text.format.schema.properties.planningContextPatch.anyOf.find(option => option.properties)?.properties;
    expect(patch?.startsAt?.pattern).toBe('\\+08:00$');
    expect(patch?.endsAt?.pattern).toBe('\\+08:00$');
  });

  it.each([
    ['another Conversation', { conversationId: 'conversation-2' }],
    ['another Trip', { tripId: 'trip-2' }],
    ['a stale PlanningContext version', { planningContextVersion: 2 }],
  ])('rejects a proposal bound to %s', async (_description, proposalPatch) => {
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com', responsesPath: '/responses', apiKey: 'test-only-key', model: 'gpt-5.5', reasoningEffort: 'high', timeoutMs: 5_000,
      fetch: async () => responseWith({
        assistantMessage: 'proposal', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [],
        planProposal: {
          conversationId: 'conversation-1', tripId: 'trip-1', planningContextVersion: 1, proposedPlaces: [], itinerary: [],
          budgetSummary: {
            limit: { amountCents: 100_000, currency: 'CNY' }, estimatedTotal: { amountCents: 0, currency: 'CNY' },
            groupTotal: { amountCents: 0, currency: 'CNY' }, perPerson: { amountCents: 0, currency: 'CNY' }, byCategory: {}, utilizationPercent: 0, warnings: [],
          },
          warnings: [], expiresAt: '2026-09-05T00:00:00.000Z', ...proposalPatch,
        },
      }),
    });

    await expect(provider.generatePlan({ ...context, conversationId: 'conversation-1', planningContext: { ...context.planningContext, version: 1 } }))
      .rejects.toBeInstanceOf(ModelProtocolError);
  });

  it('rejects missing credentials before issuing a network request', async () => {
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com',
      responsesPath: '/responses',
      apiKey: '',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      timeoutMs: 5_000,
      fetch: async () => { throw new Error('network should not be called'); },
    });

    await expect(provider.generatePlan(context)).rejects.toBeInstanceOf(ModelConfigurationError);
  });

  it('does not substitute the rule provider in test mode', () => {
    expect(createPlanningProvider({ NODE_ENV: 'test', TRAVEL_AGENT_TEST_PROVIDER: 'rule', TRAVEL_LLM_API_KEY: 'configured' }))
      .toBeInstanceOf(ThirdPartyResponsesProvider);
  });

  it('rejects model output that omits the new required planning fields', async () => {
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com', responsesPath: '/responses', apiKey: 'test-only-key', model: 'gpt-5.5', reasoningEffort: 'high', timeoutMs: 5_000,
      fetch: async () => responseWith({ assistantMessage: 'incomplete', missingFields: [], toolCalls: [], actionRequests: [] }),
    });
    await expect(provider.generatePlan(context)).rejects.toBeInstanceOf(ModelProtocolError);
  });

  it('rejects malformed model output instead of guessing a planning result', async () => {
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com',
      responsesPath: '/responses',
      apiKey: 'test-only-key',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      timeoutMs: 5_000,
      fetch: async () => new Response(JSON.stringify({
        id: 'resp-2',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"assistantMessage":42}' }] }],
      }), { status: 200 }),
    });

    await expect(provider.generatePlan(context)).rejects.toBeInstanceOf(ModelProtocolError);
  });

  it('does not expose an upstream response body in request errors', async () => {
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com',
      responsesPath: '/responses',
      apiKey: 'test-only-key',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      timeoutMs: 5_000,
      fetch: async () => new Response('upstream-secret-body', { status: 429 }),
    });

    const error = await provider.generatePlan(context).catch(value => value as Error);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error.message).toContain('429');
    expect(error.message).not.toContain('upstream-secret-body');
  });

  it('times out when the response body stalls after headers arrive', async () => {
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com',
      responsesPath: '/responses',
      apiKey: 'test-only-key',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      timeoutMs: 10,
      fetch: async (_input, init) => {
        const signal = init?.signal;
        return {
          ok: true,
          json: () => new Promise((resolve, reject) => {
            const delayedBody = setTimeout(() => resolve({
              output: [{
                type: 'message',
                content: [{
                  type: 'output_text',
                  text: JSON.stringify({ assistantMessage: 'late response', missingFields: [], toolCalls: [], actionRequests: [] }),
                }],
              }],
            }), 50);
            signal?.addEventListener('abort', () => {
              clearTimeout(delayedBody);
              reject(new DOMException('request aborted', 'AbortError'));
            }, { once: true });
          }),
        } as Response;
      },
    });

    const error = await provider.generatePlan(context).catch(value => value as Error);

    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error.message).toBe('model request timed out');
  });

  it('rejects an unsafe model endpoint before issuing a request', async () => {
    let called = false;
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'http://127.0.0.1:8080',
      responsesPath: '/responses',
      apiKey: 'test-only-key',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      timeoutMs: 5_000,
      fetch: async () => { called = true; return responseWith({ assistantMessage: 'x', missingFields: [], toolCalls: [], actionRequests: [] }); },
    });
    await expect(provider.generatePlan(context)).rejects.toBeInstanceOf(ModelConfigurationError);
    expect(called).toBe(false);
  });
});
