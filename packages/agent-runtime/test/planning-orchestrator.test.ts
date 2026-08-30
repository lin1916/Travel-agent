import { describe, expect, it } from 'vitest';
import { CapabilityGateway } from '@travel/capability-gateway';
import { PlanningOrchestrator } from '../src/planning-orchestrator.js';
import type { AgentRunPersistence, AgentRunSnapshot } from '../src/agent-run.js';
import { RuleBasedProvider } from '../src/rule-based-provider.js';
import type { CapabilityTool } from '@travel/capability-gateway';
import { z } from 'zod';

const makeGateway = () => {
  const calls: string[] = [];
  const tool: CapabilityTool<{ kind: string }, { kind: string; source: string; updatedAt: string }> = {
    name: 'search_offers',
    risk: 'read',
    inputSchema: z.object({ kind: z.string() }),
    execute: async (_context, input) => {
      calls.push(input.kind);
      await new Promise(resolve => setTimeout(resolve, 5));
      return { kind: input.kind, source: 'mock-supplier', updatedAt: '2026-08-30T00:00:00.000Z' };
    },
  };
  return { gateway: new CapabilityGateway([tool]), calls };
};

describe('PlanningOrchestrator', () => {
  it('asks one minimal question when dates are missing', async () => {
    const { gateway } = makeGateway();
    const orchestrator = new PlanningOrchestrator(new RuleBasedProvider(), gateway);
    const run = await orchestrator.start({ tripId: 'trip-1', userMessage: 'Plan a trip to Hangzhou', actorId: 'actor-1' });
    expect(run.missingFields).toEqual(['startsAt']);
    expect(run.toolCalls).toHaveLength(0);
    expect(run.assistantMessage).toMatch(/date|when/i);
  });

  it('emits four category searches in parallel for a complete request', async () => {
    const { gateway, calls } = makeGateway();
    const orchestrator = new PlanningOrchestrator(new RuleBasedProvider(), gateway);
    const run = await orchestrator.start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03 for 2 travelers', actorId: 'actor-1' });
    expect(calls).toEqual(expect.arrayContaining(['train', 'stay', 'attraction', 'dining']));
    expect(run.toolCalls).toHaveLength(4);
    expect(run.assistantMessage).toContain('mock-supplier');
    expect(run.assistantMessage).toContain('2026-08-30T00:00:00.000Z');
    expect(run.assistantMessage).toContain('risk=read');
    expect((run as unknown as { chainOfThought?: unknown }).chainOfThought).toBeUndefined();
  });

  it('keeps date-only inputs in CST and asks instead of clamping more than six travelers', async () => {
    const { gateway } = makeGateway();
    const orchestrator = new PlanningOrchestrator(new RuleBasedProvider(), gateway);
    const complete = await orchestrator.start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03 for 2 travelers', actorId: 'actor-1' });
    const callInput = complete.toolCallSummaries[0]?.inputSummary;
    expect(callInput).toEqual({ kind: 'train' });
    const providerOutput = await new RuleBasedProvider().generatePlan({ tripId: 'trip-1', agentRunId: 'run-1', userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03 for 2 travelers', currentTripVersion: 1, redactedOffers: [] });
    expect((providerOutput.toolCalls[0]?.input as { startsAt: string }).startsAt).toBe('2026-09-01T00:00:00.000+08:00');
    const tooMany = await orchestrator.start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03 for 7 travelers', actorId: 'actor-1' });
    expect(tooMany.missingFields).toEqual(['travelers']);
    expect(tooMany.toolCallSummaries).toHaveLength(0);
    const tooManyChinese = await orchestrator.start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03 for 7人', actorId: 'actor-1' });
    expect(tooManyChinese.missingFields).toEqual(['travelers']);
    expect(tooManyChinese.toolCallSummaries).toHaveLength(0);
  });

  it('rejects unknown trips before creating an agent run', async () => {
    const { gateway } = makeGateway();
    const persistence: AgentRunPersistence = {
      create: async () => { throw new Error('create should not be called'); },
      get: async () => undefined,
      save: async run => run,
    };
    const reader = { getAny: async () => null };
    const orchestrator = new PlanningOrchestrator(new RuleBasedProvider(), gateway, persistence, reader);
    await expect(orchestrator.start({ tripId: 'missing-trip', userMessage: 'Plan Hangzhou', actorId: 'actor-1' }))
      .rejects.toThrow('trip not found');
  });

  it('redacts traveler secrets before invoking a provider', async () => {
    const { gateway } = makeGateway();
    let seen = '';
    const provider = { generatePlan: async (input: import('@travel/contracts').AgentContext) => { seen = input.userMessage; return { assistantMessage: 'ok', missingFields: [], toolCalls: [], actionRequests: [] }; } };
    const orchestrator = new PlanningOrchestrator(provider, gateway);
    await orchestrator.start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou 13812345678 passport ABC123', actorId: 'actor-1' });
    expect(seen).toContain('[REDACTED_PHONE]');
    expect(seen).toContain('passport [REDACTED]');
    expect(seen).not.toContain('13812345678');
  });

  it('uses authoritative trip version and blocks resume after a trip changes', async () => {
    let version = 3;
    let seenVersion = 0;
    const provider = { generatePlan: async (input: import('@travel/contracts').AgentContext) => { seenVersion = input.currentTripVersion; return { assistantMessage: 'ok', missingFields: [], toolCalls: [], actionRequests: [] }; } };
    const reader = { getAny: async () => ({ id: 'trip-1', version, ownerId: 'actor-1' }) };
    const { gateway } = makeGateway();
    const orchestrator = new PlanningOrchestrator(provider, gateway, undefined, reader);
    const run = await orchestrator.start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou', actorId: 'actor-1' });
    expect(seenVersion).toBe(3);
    version = 4;
    await expect(orchestrator.resume(run.runId, '2026-09-01 to 2026-09-03', 'actor-1')).rejects.toThrow('trip version changed');
  });

  it('creates a confirmation action for an authenticated commit request', async () => {
    const { gateway } = makeGateway();
    const orchestrator = new PlanningOrchestrator(new RuleBasedProvider(), gateway);
    const run = await orchestrator.start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03', actorId: 'actor-1', requestedRisk: 'commit' });
    expect(run.status).toBe('awaiting_input');
    expect(run.actionRequests[0]).toMatchObject({ kind: 'confirmation_required' });
  });

  it('recovers a completed run through the injected persistence boundary', async () => {
    const persisted = new Map<string, AgentRunSnapshot>();
    const persistence: AgentRunPersistence = {
      create: run => { persisted.set(run.runId, structuredClone(run)); },
      get: runId => persisted.get(runId) ? structuredClone(persisted.get(runId)) : undefined,
      save: run => { persisted.set(run.runId, structuredClone(run)); },
    };
    const first = new PlanningOrchestrator(new RuleBasedProvider(), makeGateway().gateway, persistence);
    const created = await first.start({ tripId: 'trip-1', userMessage: 'Plan Hangzhou from 2026-09-01 to 2026-09-03', actorId: 'actor-1' });
    const restarted = new PlanningOrchestrator(new RuleBasedProvider(), makeGateway().gateway, persistence);
    expect(await restarted.get(created.runId, 'actor-1')).toMatchObject({ runId: created.runId, status: 'completed', currentTripVersion: 1 });
  });
});
