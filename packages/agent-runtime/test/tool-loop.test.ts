import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StructuredAgentOutput } from '@travel/contracts';
import { CapabilityGateway, type CapabilityTool } from '@travel/capability-gateway';
import { PlanningOrchestrator } from '../src/planning-orchestrator.js';
import type { LlmProvider, LlmTurnInput } from '../src/llm-provider.js';

function gatewayReturning(result: Record<string, unknown>, calls: string[]) {
  const tool: CapabilityTool<{ tripId: string; kind: string }, Record<string, unknown>> = {
    name: 'search_offers',
    risk: 'read',
    inputSchema: z.object({ tripId: z.string(), kind: z.string() }),
    execute: async (_context, input) => { calls.push(input.kind); return result; },
  };
  return new CapabilityGateway([tool]);
}

function planningContextGateway(calls: Array<{ expectedContextVersion: number; patch: { destination?: string } }>) {
  const tool: CapabilityTool<{ expectedContextVersion: number; patch: { destination?: string } }, Record<string, unknown>> = {
    name: 'update_planning_context',
    risk: 'prepare',
    inputSchema: z.object({
      expectedContextVersion: z.number().int().positive(),
      patch: z.object({ destination: z.string().optional() }),
    }),
    execute: async (_context, input) => {
      calls.push(structuredClone(input));
      return {
        context: {
          conversationId: 'conversation-1', version: input.expectedContextVersion + 1,
          ...(input.patch.destination ? { destination: input.patch.destination } : {}),
          preferences: [], assumptions: [], missingFields: ['startsAt', 'endsAt', 'travelerCount'],
          updatedAt: '2026-09-03T01:00:00.000Z',
        },
      };
    },
  };
  return new CapabilityGateway([tool]);
}

describe('PlanningOrchestrator tool loop', () => {
  it('applies a structured PlanningContext patch when the model omits an explicit tool call', async () => {
    const calls: Array<{ expectedContextVersion: number; patch: { destination?: string } }> = [];
    let turns = 0;
    const provider: LlmProvider = {
      generatePlan: async (): Promise<StructuredAgentOutput> => {
        turns += 1;
        return turns === 1
          ? {
              assistantMessage: '已识别目的地。', planningContextPatch: { destination: '杭州' },
              missingFields: ['startsAt', 'endsAt', 'travelerCount'], toolCalls: [], actionRequests: [], planProposal: null,
            }
          : {
              assistantMessage: '还需要确认日期和人数。', planningContextPatch: { destination: '杭州' },
              missingFields: ['startsAt', 'endsAt', 'travelerCount'], toolCalls: [], actionRequests: [], planProposal: null,
            };
      },
    };

    const run = await new PlanningOrchestrator(provider, planningContextGateway(calls)).start({
      conversationId: 'conversation-1', actorId: 'session-1', requestedRisk: 'prepare', userMessage: '我想去杭州',
    });

    expect(calls).toEqual([{ expectedContextVersion: 1, patch: { destination: '杭州' } }]);
    expect(turns).toBe(2);
    expect(run.planningContext).toMatchObject({ version: 2, destination: '杭州' });
    expect(run.assistantMessage).toBe('还需要确认日期和人数。');
  });

  it('does not duplicate an explicit PlanningContext update tool call', async () => {
    const calls: Array<{ expectedContextVersion: number; patch: { destination?: string } }> = [];
    let turns = 0;
    const provider: LlmProvider = {
      generatePlan: async (): Promise<StructuredAgentOutput> => {
        turns += 1;
        const base: Omit<StructuredAgentOutput, 'toolCalls'> = {
          assistantMessage: '已识别目的地。', planningContextPatch: { destination: '杭州' },
          missingFields: ['startsAt', 'endsAt', 'travelerCount'], actionRequests: [], planProposal: null,
        };
        return turns === 1
          ? { ...base, toolCalls: [{ toolName: 'update_planning_context', input: { expectedContextVersion: 1, patch: { destination: '杭州' } } }] }
          : { ...base, toolCalls: [] };
      },
    };

    const run = await new PlanningOrchestrator(provider, planningContextGateway(calls)).start({
      conversationId: 'conversation-1', actorId: 'session-1', requestedRisk: 'prepare', userMessage: '我想去杭州',
    });

    expect(calls).toHaveLength(1);
    expect(turns).toBe(2);
    expect(run.planningContext).toMatchObject({ version: 2, destination: '杭州' });
  });
  it('executes model tool calls through the gateway and returns redacted results to the model', async () => {
    const calls: string[] = [];
    const turns: LlmTurnInput[] = [];
    const provider: LlmProvider = {
      generatePlan: async input => {
        turns.push(structuredClone(input));
        if (turns.length === 1) return { assistantMessage: 'Searching', missingFields: [], toolCalls: [{ toolName: 'search_offers', input: { tripId: 'trip-1', kind: 'train' } }], actionRequests: [] };
        return { assistantMessage: `Found ${input.toolResults[0]?.result.kind}`, missingFields: [], toolCalls: [], actionRequests: [] };
      },
    };
    const gateway = gatewayReturning({ kind: 'train', source: 'rail-api', authorization: 'Bearer secret', email: 'guest@example.com' }, calls);

    const run = await new PlanningOrchestrator(provider, gateway).start({ tripId: 'trip-1', userMessage: 'Find a train' });

    expect(calls).toEqual(['train']);
    expect(run.assistantMessage).toBe('Found train');
    expect(JSON.stringify(turns[1]?.toolResults)).toContain('rail-api');
    expect(JSON.stringify(turns[1]?.toolResults)).not.toMatch(/secret|guest@example\.com/);
  });

  it('fails without executing a ninth tool round', async () => {
    const calls: string[] = [];
    const provider: LlmProvider = {
      generatePlan: async () => ({ assistantMessage: 'Again', missingFields: [], toolCalls: [{ toolName: 'search_offers', input: { tripId: 'trip-1', kind: 'train' } }], actionRequests: [] }),
    };

    const run = await new PlanningOrchestrator(provider, gatewayReturning({ kind: 'train' }, calls)).start({ tripId: 'trip-1', userMessage: 'Keep searching' });

    expect(calls).toHaveLength(8);
    expect(run.status).toBe('failed');
    expect(run.toolCallSummaries).toHaveLength(8);
  });

  it('redacts prior messages before sending conversation history to the provider', async () => {
    let seen = '';
    const provider: LlmProvider = {
      generatePlan: async input => {
        seen = input.messages.map(message => message.content).join(' ');
        return { assistantMessage: 'ok', missingFields: [], toolCalls: [], actionRequests: [] };
      },
    };

    await new PlanningOrchestrator(provider, new CapabilityGateway()).start({
      tripId: 'trip-1',
      userMessage: 'continue',
      messages: [{ role: 'user', content: 'Call 13812345678 and use passport ABC123' }, { role: 'assistant', content: 'Noted' }],
    });

    expect(seen).not.toMatch(/13812345678|ABC123/);
    expect(seen).toContain('[REDACTED');
  });

  it('publishes only safe turn, tool, and failure lifecycle events', async () => {
    const events: Array<{ type: string; runId: string; correlationId: string; payload: Record<string, unknown> }> = [];
    const provider: LlmProvider = {
      generatePlan: async () => ({ assistantMessage: 'Again', missingFields: [], toolCalls: [{ toolName: 'search_offers', input: { tripId: 'trip-1', kind: 'train' } }], actionRequests: [] }),
    };

    const run = await new PlanningOrchestrator(provider, gatewayReturning({ kind: 'train' }, [])).start({
      tripId: 'trip-1', userMessage: 'search', correlationId: 'corr-1', onEvent: event => { events.push(event); },
    });

    expect(events.map(event => event.type)).toEqual([
      'AgentTurnStarted',
      'ToolCallStarted', 'ToolCallCompleted',
      'ToolCallStarted', 'ToolCallCompleted',
      'ToolCallStarted', 'ToolCallCompleted',
      'ToolCallStarted', 'ToolCallCompleted',
      'ToolCallStarted', 'ToolCallCompleted',
      'ToolCallStarted', 'ToolCallCompleted',
      'ToolCallStarted', 'ToolCallCompleted',
      'ToolCallStarted', 'ToolCallCompleted',
      'AgentTurnFailed',
    ]);
    expect(new Set(events.map(event => event.runId))).toEqual(new Set([run.runId]));
    expect(new Set(events.filter(event => event.type === 'AgentTurnStarted' || event.type === 'AgentTurnFailed').map(event => event.correlationId))).toEqual(new Set(['corr-1']));
    expect(new Set(events.filter(event => event.type.startsWith('ToolCall')).map(event => event.correlationId))).toEqual(new Set(['corr-1:search_offers']));
    expect(events[0]?.payload).toEqual({ turnId: run.runId });
    expect(events.at(-1)?.payload).toEqual({ retryable: true, code: 'tool_round_limit' });
    expect(JSON.stringify(events)).not.toMatch(/tripId|kind|input|result|prompt|authorization/);
  });

  it('deletes named runs and purges runs older than a TTL cutoff', async () => {
    let now = new Date('2026-09-01T00:00:00.000Z');
    const store = new (await import('../src/agent-run.js')).AgentRunStore(() => now);
    const old = store.create({ tripId: 'old-trip' });
    now = new Date('2026-09-09T00:00:00.000Z');
    const fresh = store.create({ tripId: 'fresh-trip' });

    expect(store.deleteExpired('2026-09-02T00:00:00.000Z')).toBe(1);
    expect(store.get(old.runId)).toBeUndefined();
    expect(store.get(fresh.runId)).toBeDefined();

    store.delete(fresh.runId);
    expect(store.get(fresh.runId)).toBeUndefined();
  });
});
