import { describe, expect, it } from 'vitest';
import { CapabilityGateway } from '@travel/capability-gateway';
import { PlanService } from '@travel/application';
import { createPlanningTools } from '../src/tool-registry.js';

describe('planning tool registry', () => {
  it('exposes only planning commands with prepare risk and no booking/payment tools', () => {
    const tools = createPlanningTools({} as never, new PlanService());
    const names = tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item', 'replace_itinerary_item',
      'lock_itinerary_item', 'optimize_day', 'check_schedule', 'calculate_budget', 'undo_plan_change',
    ]));
    expect(names.some(name => /book|pay|commit|redirect|supplier_order/i.test(name))).toBe(false);
    for (const tool of tools.filter(tool => names.includes(tool.name) && tool.name !== 'search_offers')) expect(tool.risk).toBe('prepare');
    expect(names).not.toContain('prepare_itinerary');
  });

  it('routes an add command through the PlanService boundary', async () => {
    const tools = createPlanningTools({} as never, new PlanService({ now: () => new Date('2026-09-02T00:00:00.000Z'), id: (() => { let index = 0; return () => `id-${++index}`; })() }));
    const gateway = new CapabilityGateway(tools);
    const result = await gateway.execute('add_itinerary_item', {
      actorId: 'owner-1', tripId: 'trip-1', agentRunId: 'run-1', correlationId: 'corr-1', requestedRisk: 'prepare', actorAuthenticated: false, currentTripVersion: 1, expectedTripVersion: 1,
    }, {
      tripId: 'trip-1', expectedVersion: 1, item: { category: 'attraction', title: '西湖', startsAt: '2026-10-01T09:00:00.000+08:00', endsAt: '2026-10-01T11:00:00.000+08:00', location: { city: '杭州' }, estimatedCostCents: 0 },
    });
    expect(result).toMatchObject({ tripId: 'trip-1', version: 2, items: [expect.objectContaining({ title: '西湖' })] });
  });

  it('applies schema defaults when optional cost fields are omitted', async () => {
    const tools = createPlanningTools({} as never, new PlanService({ now: () => new Date('2026-09-02T00:00:00.000Z'), id: (() => { let index = 0; return () => `id-${++index}`; })() }));
    const gateway = new CapabilityGateway(tools);
    const result = await gateway.execute('add_itinerary_item', {
      actorId: 'owner-1', tripId: 'trip-1', agentRunId: 'run-1', correlationId: 'corr-1', requestedRisk: 'prepare', actorAuthenticated: false, currentTripVersion: 1, expectedTripVersion: 1,
    }, {
      tripId: 'trip-1', expectedVersion: 1, item: { category: 'attraction', title: '西湖', startsAt: '2026-10-01T09:00:00.000+08:00', endsAt: '2026-10-01T11:00:00.000+08:00', location: { city: '杭州' } },
    });
    expect(result).toMatchObject({ items: [{ estimatedCostCents: 0, priceScope: 'group' }] });
  });

  it('passes authoritative traveler and budget context into plan commands', async () => {
    const planService = new PlanService({ now: () => new Date('2026-09-02T00:00:00.000Z'), id: (() => { let index = 0; return () => `id-${++index}`; })() });
    const tools = createPlanningTools(
      {} as never,
      planService,
      async () => ({ travelerCount: 2, totalBudgetCents: 500_000 }),
    );
    const gateway = new CapabilityGateway(tools);
    const result = await gateway.execute('add_itinerary_item', {
      actorId: 'owner-1', tripId: 'trip-1', agentRunId: 'run-1', correlationId: 'corr-1', requestedRisk: 'prepare', actorAuthenticated: false, currentTripVersion: 1, expectedTripVersion: 1,
    }, {
      tripId: 'trip-1', expectedVersion: 1, item: { category: 'attraction', title: '西湖', startsAt: '2026-10-01T09:00:00.000+08:00', endsAt: '2026-10-01T11:00:00.000+08:00', location: { city: '杭州' }, estimatedCostCents: 400_000, priceScope: 'group' },
    });

    expect(result).toMatchObject({ budget: { limit: { amountCents: 500_000 }, perPerson: { amountCents: 200_000 }, warnings: ['budget_80_percent'] } });
  });
});
