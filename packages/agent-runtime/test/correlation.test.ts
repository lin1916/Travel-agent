import { describe, expect, it } from 'vitest';
import { PlanningOrchestrator } from '../src/planning-orchestrator.js';
describe('planning correlation persistence', () => {
  it('passes a stable correlation id to the provider context', async () => {
    let seen: string | undefined;
    const provider:any = { generatePlan: async (ctx:any) => { seen = ctx.correlationId; return { assistantMessage:'ok', missingFields:[], toolCalls:[], actionRequests:[] }; } };
    const gateway:any = { execute: async()=>({}), riskOf:()=> 'read' };
    await new PlanningOrchestrator(provider, gateway).start({ tripId:'trip-1', userMessage:'hi', correlationId:'corr-1' });
    expect(seen).toBe('corr-1');
  });
});
