import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CapabilityGateway, type CapabilityContext, type CapabilityTool } from '@travel/capability-gateway';
import type { PlanProposalDraft, PlanningContext } from '@travel/contracts';
import { PlanService } from '@travel/application';
import { AgentRunStore } from '../src/agent-run.js';
import { createConversationPlanningTools } from '../src/conversation-tools.js';
import { PlanningOrchestrator } from '../src/planning-orchestrator.js';
import { createPlanningTools } from '../src/tool-registry.js';
import { ModelProtocolError, ThirdPartyResponsesProvider } from '../src/responses-provider.js';

const initialContext: PlanningContext = {
  conversationId: 'conversation-1',
  version: 1,
  preferences: [],
  assumptions: [],
  missingFields: ['destination', 'startsAt', 'endsAt', 'travelerCount'],
  updatedAt: '2026-09-03T00:00:00.000Z',
};

const completedContext: PlanningContext = {
  ...initialContext,
  version: 2,
  destination: '杭州',
  startsAt: '2026-10-01T00:00:00+08:00',
  endsAt: '2026-10-04T00:00:00+08:00',
  travelerCount: 2,
  totalBudgetCents: 500_000,
  missingFields: [],
};

const proposal: PlanProposalDraft = {
  conversationId: 'conversation-1',
  tripId: 'trip-1',
  planningContextVersion: 2,
  proposedPlaces: [],
  itinerary: [{
    category: 'attraction',
    title: '西湖',
    startsAt: '2026-10-01T09:00:00+08:00',
    endsAt: '2026-10-01T12:00:00+08:00',
    location: { city: '杭州' },
    estimatedCostCents: 0,
    priceScope: 'group',
  }],
  budgetSummary: {
    limit: { amountCents: 500_000, currency: 'CNY' },
    estimatedTotal: { amountCents: 80_000, currency: 'CNY' },
    groupTotal: { amountCents: 80_000, currency: 'CNY' },
    perPerson: { amountCents: 40_000, currency: 'CNY' },
    byCategory: {},
    utilizationPercent: 16,
    warnings: [],
  },
  warnings: [],
  reasoningSummary: '根据距离、预算和游玩节奏组合了杭州行程。',
  expiresAt: '2026-09-04T00:00:00.000Z',
};

function responseWith(output: unknown): Response {
  return new Response(JSON.stringify({
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('conversation-first planning runtime', () => {
  it('creates a Trip during the same bounded run and returns reasoning plus a proposal', async () => {
    const requests: Array<Record<string, any>> = [];
    const outputs = [
      {
        assistantMessage: '已识别完整出行条件。',
        planningContextPatch: {
          destination: '杭州', startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00', travelerCount: 2, totalBudgetCents: 500_000,
        },
        reasoningSummary: '出行条件完整，可以创建 Trip。',
        missingFields: [],
        toolCalls: [{ toolName: 'update_planning_context', input: { expectedContextVersion: 1, patch: {
          destination: '杭州', startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00', travelerCount: 2, totalBudgetCents: 500_000,
        } } }],
        actionRequests: [],
        planProposal: null,
      },
      {
        assistantMessage: '正在搜索杭州交通方案。', planningContextPatch: null, reasoningSummary: 'Trip 已创建，开始查询真实供应信息。', missingFields: [],
        toolCalls: [{ toolName: 'search_offers', input: { tripId: 'trip-1', kind: 'train', destination: '杭州', startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00', travelers: 2 } }],
        actionRequests: [], planProposal: null,
      },
      {
        assistantMessage: '杭州行程草案已经准备好。', planningContextPatch: null, reasoningSummary: proposal.reasoningSummary, missingFields: [], toolCalls: [], actionRequests: [], planProposal: proposal,
      },
    ];
    const provider = new ThirdPartyResponsesProvider({
      baseUrl: 'https://apizh-ai.com', responsesPath: '/responses', apiKey: 'test-key', model: 'gpt-5.5', reasoningEffort: 'high', timeoutMs: 5_000,
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return responseWith(outputs[requests.length - 1]);
      },
    });
    const tools = createConversationPlanningTools(
      { applyAndEnsureTrip: async () => ({ context: completedContext, trip: { id: 'trip-1', version: 1, ownerId: 'session-1' } }) },
      { searchPlaces: async () => [] },
      { list: async () => [] },
    );
    const searchOffers: CapabilityTool<Record<string, unknown>, Record<string, unknown>> = {
      name: 'search_offers', risk: 'read', inputSchema: z.object({ tripId: z.string(), kind: z.string() }).passthrough(),
      execute: async () => ({ source: 'fake-supplier', offers: [] }),
    };
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const run = await new PlanningOrchestrator(provider, new CapabilityGateway([...tools, searchOffers])).start({
      actorId: 'session-1', conversationId: 'conversation-1', userMessage: '十月一日去杭州玩四天，两个人，预算五千。',
      planningContext: initialContext, requestedRisk: 'prepare', onEvent: event => { events.push(event); },
    });

    expect(run).toMatchObject({ tripId: 'trip-1', currentTripVersion: 1, reasoningSummary: proposal.reasoningSummary, planProposal: proposal });
    expect(JSON.stringify(requests[1])).toContain('trip-1');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PlanningContextUpdated', payload: { version: 2, populatedFields: expect.any(Array), missingFields: [], tripCreated: true } }),
      expect.objectContaining({ type: 'ReasoningSummaryUpdated', payload: { summary: proposal.reasoningSummary } }),
      expect.objectContaining({ type: 'PlanProposalCreated', payload: { itemCount: 1, estimatedTotalCents: 80_000 } }),
    ]));
    expect(JSON.stringify(events)).not.toMatch(/expectedContextVersion|authorization|test-key|toolResults|travelPlanningContext/);
  });

  it('allows conversation tools before Trip creation but blocks Trip-owned search', async () => {
    const called: string[] = [];
    const gateway = new CapabilityGateway([
      ...createConversationPlanningTools(
        { applyAndEnsureTrip: async () => { called.push('update_planning_context'); return { context: initialContext }; } },
        { searchPlaces: async () => { called.push('search_places'); return []; } },
        { list: async () => { called.push('list_candidate_places'); return []; } },
      ),
      { name: 'search_offers', risk: 'read', inputSchema: z.object({ tripId: z.string() }), execute: async () => { called.push('search_offers'); return {}; } },
    ]);
    const preTrip: CapabilityContext = { actorId: 'session-1', conversationId: 'conversation-1', agentRunId: 'run-1', correlationId: 'corr-1', requestedRisk: 'prepare' };

    await gateway.execute('update_planning_context', preTrip, { expectedContextVersion: 1, patch: { destination: '杭州' } });
    await gateway.execute('search_places', preTrip, { query: '西湖' });
    await gateway.execute('list_candidate_places', preTrip, {});
    await expect(gateway.execute('search_offers', preTrip, { tripId: 'trip-1' })).rejects.toMatchObject({ code: 'policy_blocked' });
    expect(called).toEqual(['update_planning_context', 'search_places', 'list_candidate_places']);
  });

  it('blocks formal Plan mutations from Conversation scope while preserving direct Trip commands', async () => {
    const plans = new PlanService();
    const gateway = new CapabilityGateway(createPlanningTools({ search: async () => ({}) } as never, plans));
    const item = {
      category: 'attraction' as const, title: '西湖', startsAt: '2026-10-01T09:00:00+08:00',
      endsAt: '2026-10-01T11:00:00+08:00', location: { city: '杭州' }, estimatedCostCents: 0,
    };
    const scoped = {
      actorId: 'session-1', tripId: 'trip-1', agentRunId: 'run-1', correlationId: 'corr-1',
      requestedRisk: 'prepare' as const, currentTripVersion: 1, expectedTripVersion: 1,
    };

    await expect(gateway.execute('add_itinerary_item', { ...scoped, conversationId: 'conversation-1' }, {
      tripId: 'trip-1', expectedVersion: 1, item,
    })).rejects.toMatchObject({ code: 'policy_blocked' });
    await expect(plans.lookupCurrent('trip-1', 'session-1')).resolves.toBeUndefined();

    await expect(gateway.execute('add_itinerary_item', scoped, { tripId: 'trip-1', expectedVersion: 1, item }))
      .resolves.toMatchObject({ version: 2, items: [expect.objectContaining({ title: '西湖' })] });
  });
  it('preserves direct Trip starts without a Conversation', async () => {
    const provider = { generatePlan: async () => ({ assistantMessage: 'ok', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null }) };
    await expect(new PlanningOrchestrator(provider, new CapabilityGateway()).start({ tripId: 'trip-1', userMessage: 'Plan it' }))
      .resolves.toMatchObject({ tripId: 'trip-1', conversationId: undefined, status: 'completed' });
  });

  it('rejects a start with neither Conversation nor Trip before provider or tool execution', async () => {
    let providerCalls = 0;
    let toolCalls = 0;
    const provider = { generatePlan: async () => { providerCalls += 1; return { assistantMessage: 'no', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [], planProposal: null }; } };
    const gateway = new CapabilityGateway([{ name: 'noop', risk: 'read', inputSchema: z.object({}), execute: async () => { toolCalls += 1; return {}; } }]);

    await expect(new PlanningOrchestrator(provider, gateway).start({ userMessage: 'Plan it' })).rejects.toThrow('conversationId or tripId is required');
    expect(providerCalls).toBe(0);
    expect(toolCalls).toBe(0);
  });

  it('deletes every historical run for a Conversation', () => {
    const store = new AgentRunStore();
    const first = store.create({ conversationId: 'conversation-1', userMessage: 'first' });
    const second = store.create({ conversationId: 'conversation-1', userMessage: 'second' });
    const other = store.create({ conversationId: 'conversation-2', userMessage: 'other' });

    expect(store.deleteConversation('conversation-1')).toBe(2);
    expect(store.get(first.runId)).toBeUndefined();
    expect(store.get(second.runId)).toBeUndefined();
    expect(store.get(other.runId)).toBeDefined();
  });

  it('fails before persisting or emitting a proposal that is not bound to the active run', async () => {
    const store = new AgentRunStore();
    const events: Array<{ type: string; runId: string }> = [];
    const provider = {
      generatePlan: async () => ({
        assistantMessage: 'invalid proposal', planningContextPatch: null, missingFields: [], toolCalls: [], actionRequests: [],
        planProposal: { ...proposal, conversationId: 'conversation-2' },
      }),
    };
    const orchestrator = new PlanningOrchestrator(provider, new CapabilityGateway(), store);

    await expect(orchestrator.start({
      actorId: 'session-1', conversationId: 'conversation-1', tripId: 'trip-1', userMessage: 'make a proposal', planningContext: completedContext,
      onEvent: event => { events.push(event); },
    })).rejects.toBeInstanceOf(ModelProtocolError);

    expect(events.some(event => event.type === 'PlanProposalCreated')).toBe(false);
    expect(events.at(-1)?.type).toBe('AgentTurnFailed');
    const runId = events[0]?.runId;
    expect(runId ? store.get(runId)?.planProposal : undefined).toBeNull();
  });
});
