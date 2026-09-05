import { describe, expect, it } from 'vitest';
import { CapabilityGateway } from '@travel/capability-gateway';
import { z } from 'zod';
import { createPiTravelTools, redactForModel } from '../src/pi-travel-tools.js';

describe('Pi travel tools', () => {
  it('preserves non-sensitive traveler counts while redacting traveler identity records', () => {
    expect(redactForModel({ travelerCount: 2, travelers: 2, travelerProfile: { name: 'private-name' }, travelersData: ['private-name'] })).toEqual({
      travelerCount: 2, travelers: 2, travelerProfile: '[REDACTED]', travelersData: '[REDACTED]',
    });
    expect(redactForModel({ travelers: [{ name: 'private-name' }] })).toEqual({ travelers: '[REDACTED]' });
  });
  it('does not expose formal Plan mutation tools to Conversation-scoped Pi runs', () => {
    const names = createPiTravelTools(new CapabilityGateway(), {
      actorId: 'session-1', conversationId: 'conversation-1', agentRunId: 'run-1', correlationId: 'corr-1', requestedRisk: 'prepare',
    }).map(tool => tool.name);

    expect(names).toEqual(['update_planning_context', 'search_places', 'list_candidate_places', 'search_offers']);
    expect(names).not.toEqual(expect.arrayContaining(['check_schedule', 'calculate_budget']));
  });

  it('declares PlanningContext timestamps as China Standard Time', () => {
    const tool = createPiTravelTools(new CapabilityGateway()).find(item => item.name === 'update_planning_context');
    const properties = (tool?.parameters as { properties?: { patch?: { properties?: Record<string, { pattern?: string }> } } }).properties?.patch?.properties;

    expect(properties?.startsAt?.pattern).toBe('\\+08:00$');
    expect(properties?.endsAt?.pattern).toBe('\\+08:00$');
  });

  it('routes a Pi travel tool through Capability Gateway', async () => {
    const calls: string[] = [];
    const gateway = new CapabilityGateway();
    gateway.register({
      name: 'search_offers', risk: 'read',
      inputSchema: z.object({ tripId: z.string(), kind: z.string(), destination: z.string(), startsAt: z.string(), endsAt: z.string(), travelers: z.number() }),
      execute: async (_context, _input) => { calls.push('search_offers'); return { kind: 'attraction', offers: [] }; },
    });
    const tool = createPiTravelTools(gateway, { tripId: 'trip-1' }).find(item => item.name === 'search_offers');
    await tool?.execute('tool-1', { tripId: 'trip-1', kind: 'attraction', origin: 'Hangzhou', destination: 'Hangzhou', startsAt: '2026-09-10T00:00:00+08:00', endsAt: '2026-09-12T00:00:00+08:00', travelers: 2 });
    expect(calls).toEqual(['search_offers']);
  });

  it('uses supplied run context when search input omits tripId', async () => {
    const calls: string[] = [];
    const gateway = new CapabilityGateway();
    gateway.register({
      name: 'search_offers', risk: 'read',
      inputSchema: z.object({ tripId: z.string(), kind: z.string(), destination: z.string(), startsAt: z.string(), endsAt: z.string(), travelers: z.number() }),
      execute: async (_context, _input) => { calls.push('search_offers'); return { kind: 'attraction', offers: [] }; },
    });
    const tool = createPiTravelTools(gateway, { tripId: 'trip-ctx', agentRunId: 'run-1', correlationId: 'corr-1' }).find(item => item.name === 'search_offers');
    await tool?.execute('tool-1', { kind: 'attraction', destination: 'Hangzhou', startsAt: '2026-09-10T00:00:00+08:00', endsAt: '2026-09-12T00:00:00+08:00', travelers: 2 });
    expect(calls).toEqual(['search_offers']);
  });

  it('does not expose payment or booking tools', () => {
    expect(createPiTravelTools(new CapabilityGateway()).map(tool => tool.name)).toEqual([
      'update_planning_context', 'search_places', 'list_candidate_places', 'search_offers', 'check_schedule', 'calculate_budget',
    ]);
  });

  it('keeps versioned planning tools sequential', () => {
    const tools = createPiTravelTools(new CapabilityGateway());
    expect(tools.find(tool => tool.name === 'search_offers')?.executionMode).toBe('parallel');
    expect(tools.find(tool => tool.name === 'check_schedule')?.executionMode).toBe('sequential');
    expect(tools.find(tool => tool.name === 'calculate_budget')?.executionMode).toBe('sequential');
  });

  it('redacts generic credential and document fields from tool details', async () => {
    const gateway = new CapabilityGateway();
    gateway.register({
      name: 'search_offers', risk: 'read',
      inputSchema: z.object({ tripId: z.string(), kind: z.string(), destination: z.string(), startsAt: z.string(), endsAt: z.string(), travelers: z.number() }),
      execute: async () => ({ supplierCredentials: 'secret', documentNumber: 'passport-123', title: 'safe' }),
    });
    const tool = createPiTravelTools(gateway, { tripId: 'trip-1' }).find(item => item.name === 'search_offers');
    const result = await tool?.execute('tool-1', { tripId: 'trip-1', kind: 'attraction', destination: 'Hangzhou', startsAt: '2026-09-10T00:00:00+08:00', endsAt: '2026-09-12T00:00:00+08:00', travelers: 2 });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('passport-123');
    expect(JSON.stringify(result)).toContain('[REDACTED]');
  });
});
