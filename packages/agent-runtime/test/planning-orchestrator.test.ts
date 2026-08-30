import { describe, expect, it } from 'vitest';
import { CapabilityGateway } from '@travel/capability-gateway';
import { PlanningOrchestrator } from '../src/planning-orchestrator.js';
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
});
