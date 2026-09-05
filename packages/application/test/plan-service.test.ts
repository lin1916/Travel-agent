import { describe, expect, it } from 'vitest';
import { InMemoryPlanEventPublisher, PlanService, type PlanCommand } from '../src/plans/plan-service.js';

const now = new Date('2026-09-02T10:00:00.000Z');

function service() {
  let sequence = 0;
  return new PlanService({
    now: () => now,
    id: () => `plan-${++sequence}`,
    routeEstimator: { estimate: async () => ({ minutes: 45 }) },
  });
}

const context = { travelerCount: 2, totalBudgetCents: 500_000 };

function item(overrides: Record<string, unknown> = {}) {
  return {
    category: 'attraction' as const,
    title: '西湖',
    startsAt: '2026-10-01T09:00:00.000+08:00',
    endsAt: '2026-10-01T11:00:00.000+08:00',
    location: { city: '杭州' },
    estimatedCostCents: 20_000,
    ...overrides,
  };
}

async function add(serviceInstance: PlanService, input = item(), expectedVersion = 1) {
  return serviceInstance.execute('trip-1', 'owner-1', { kind: 'add', item: input }, expectedVersion, context);
}

describe('PlanService', () => {
  it('rejects non-CST timestamps when accepting a proposal directly', async () => {
    const plans = service();
    const current = await plans.current('trip-1', 'owner-1', context);

    for (const startsAt of ['2026-10-01T01:00:00.000Z', '2026-10-01T10:00:00.000+09:00']) {
      await expect(plans.acceptProposal('trip-1', 'owner-1', [item({
        startsAt,
        endsAt: startsAt.endsWith('Z') ? '2026-10-01T03:00:00.000Z' : '2026-10-01T12:00:00.000+09:00',
      })], current.version, context)).rejects.toMatchObject({ code: 'validation_error' });
    }
  });

  it('publishes redacted lifecycle events for initialized and accepted plan versions', async () => {
    const publisher = new InMemoryPlanEventPublisher();
    const plans = new PlanService({
      now: () => now,
      id: (() => { let sequence = 0; return () => `plan-${++sequence}`; })(),
      publisher,
    });

    const empty = await plans.current('trip-1', 'owner-1', context);
    await plans.execute('trip-1', 'owner-1', { kind: 'add', item: item() }, empty.version, context);

    expect(publisher.events).toHaveLength(2);
    expect(publisher.events.map(event => event.event_type)).toEqual(['PlanVersionCreated', 'PlanVersionCreated']);
    expect(publisher.events[1]).toMatchObject({ aggregate_type: 'Trip', aggregate_id: 'trip-1', sequence: 2, redacted_payload: { version: 2, command: 'add' } });
    expect(JSON.stringify(publisher.events[1])).not.toContain('西湖');
    expect(JSON.stringify(publisher.events[1])).not.toContain('杭州');
  });

  it('appends immutable versions for add, move, replace, remove and lock commands', async () => {
    const plans = service();
    const first = await add(plans);
    expect(first.version).toBe(2);
    expect(first.items[0]).toMatchObject({ title: '西湖', locked: false });

    const moved = await plans.execute('trip-1', 'owner-1', {
      kind: 'move', itemId: first.items[0].id,
      startsAt: '2026-10-01T13:00:00.000+08:00', endsAt: '2026-10-01T15:00:00.000+08:00',
    }, first.version, context);
    expect(moved.version).toBe(3);
    expect(moved.items[0].startsAt).toContain('13:00');

    const replaced = await plans.execute('trip-1', 'owner-1', {
      kind: 'replace', itemId: first.items[0].id,
      item: item({ title: '灵隐寺', estimatedCostCents: 30_000 }),
    }, moved.version, context);
    expect(replaced.version).toBe(4);
    expect(replaced.items[0].title).toBe('灵隐寺');

    const locked = await plans.execute('trip-1', 'owner-1', {
      kind: 'lock', itemId: replaced.items[0].id,
    }, replaced.version, context);
    expect(locked.items[0].locked).toBe(true);
    await expect(plans.execute('trip-1', 'owner-1', {
      kind: 'remove', itemId: replaced.items[0].id,
    }, locked.version, context)).rejects.toMatchObject({ code: 'policy_blocked' });

    const undone = await plans.undo('trip-1', 'owner-1', locked.version, context);
    expect(undone.version).toBe(locked.version + 1);
    expect(undone.items).toEqual(replaced.items);
    expect(undone.changeSet.summary).toContain('undo');
  });

  it('rejects direct overlaps, protects locked items, and reports soft route/rhythm warnings', async () => {
    const plans = service();
    const first = await add(plans, item({ startsAt: '2026-10-01T09:00:00.000+08:00', endsAt: '2026-10-01T12:00:00.000+08:00' }));
    await expect(add(plans, item({ title: '河坊街', startsAt: '2026-10-01T11:00:00.000+08:00', endsAt: '2026-10-01T13:00:00.000+08:00' }), first.version)).rejects.toMatchObject({ code: 'conflict' });

    let current = first;
    for (let index = 0; index < 5; index += 1) {
      current = await add(plans, item({
        title: `活动 ${index}`,
        startsAt: `2026-10-01T${String(13 + index).padStart(2, '0')}:00:00.000+08:00`,
        endsAt: `2026-10-01T${String(14 + index).padStart(2, '0')}:00:00.000+08:00`,
        location: { city: index % 2 ? '上海' : '杭州' },
      }), current.version);
    }
    expect(current.warnings.map(warning => warning.code)).toContain('rhythm');
    expect(current.warnings.map(warning => warning.code)).toContain('transfer_tight');
  });

  it('calculates group and per-person estimated budget with 80 and 100 percent warnings', async () => {
    const plans = service();
    const first = await add(plans, item({ estimatedCostCents: 400_000, priceScope: 'group' }));
    expect(first.budget.estimatedTotal.amountCents).toBe(400_000);
    expect(first.budget.groupTotal.amountCents).toBe(400_000);
    expect(first.budget.perPerson.amountCents).toBe(200_000);
    expect(first.budget.warnings).toContain('budget_80_percent');

    const second = await add(plans, item({ title: '晚餐', startsAt: '2026-10-01T12:00:00.000+08:00', endsAt: '2026-10-01T13:00:00.000+08:00', estimatedCostCents: 220_000, priceScope: 'per_person' }), first.version);
    expect(second.budget.groupTotal.amountCents).toBe(840_000);
    expect(second.budget.warnings).toContain('budget_exceeded');
  });

  it('rejects stale versions and restores the exact preceding version on undo', async () => {
    const plans = service();
    const first = await add(plans);
    const second = await add(plans, item({ title: '灵隐寺', startsAt: '2026-10-01T13:00:00.000+08:00', endsAt: '2026-10-01T15:00:00.000+08:00' }), first.version);
    await expect(add(plans, item({ title: ' stale ' }), first.version)).rejects.toMatchObject({ code: 'conflict' });

    const undone = await plans.undo('trip-1', 'owner-1', second.version, context);
    expect(undone.items).toEqual(first.items);
    expect(undone.budget).toEqual(first.budget);
  });

  it('supports check, calculate and optimize commands without external side effects', async () => {
    const plans = service();
    let current = await add(plans);
    for (const kind of ['check', 'calculate', 'optimize'] as const) {
      const command = kind === 'optimize' ? { kind, day: '2026-10-01' } : { kind };
      const next = await plans.execute('trip-1', 'owner-1', command as PlanCommand, current.version, context);
      expect(next.version).toBe(current.version + 1);
      expect(next.items).toEqual(current.items);
      current = next;
    }
  });
});
