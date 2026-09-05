import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildDayTwoAdjustment, findDayTwoItem, mergeConversationMessages, workspaceSessionReference } from './PlanningWorkspace';
import { PlanningWorkspace } from './PlanningWorkspace';

describe('PlanningWorkspace', () => {
  it('persists a non-sensitive conversation reference and creates a real day-two move', () => {
    expect(workspaceSessionReference('trip-1', 'conversation-1')).toEqual({ tripId: 'trip-1', conversationId: 'conversation-1' });
    const command = buildDayTwoAdjustment({ id: 'item-2', category: 'attraction', title: '西湖', startsAt: '2026-10-02T10:00:00+08:00', endsAt: '2026-10-02T14:00:00+08:00', location: { city: '杭州' }, estimatedCostCents: 0, priceScope: 'group', locked: false });
    expect(command).toMatchObject({ kind: 'move', itemId: 'item-2' });
    expect(new Date(command.startsAt).getTime() - new Date('2026-10-02T10:00:00+08:00').getTime()).toBe(60 * 60 * 1000);
    expect(new Date(command.endsAt).getTime() - new Date('2026-10-02T14:00:00+08:00').getTime()).toBe(60 * 60 * 1000);
  });

  it('updates mounted chat messages from restored conversation and never falls back to day one', () => {
    expect(mergeConversationMessages([{ id: 'old', role: 'assistant', content: '旧内容', status: 'sent' }], [{ id: 'new', role: 'assistant', content: '恢复内容', createdAt: '2026-10-01T00:00:00Z' }])).toEqual([{ id: 'new', role: 'assistant', content: '恢复内容', createdAt: '2026-10-01T00:00:00Z', status: 'sent' }]);
    expect(findDayTwoItem([{ id: 'day-one', category: 'attraction', title: '第一天', startsAt: '2026-10-01T10:00:00+08:00', endsAt: '2026-10-01T11:00:00+08:00', estimatedCostCents: 0, priceScope: 'group', locked: false }])).toBeUndefined();
  });

  it('uses the reference workspace shell and hides the itinerary card until a plan exists', () => {
    const html = renderToStaticMarkup(
      <PlanningWorkspace
        data={{ destination: '杭州', tripId: 'trip-1', offers: {}, ranked: {}, categories: {} }}
        client={{} as never}
        actorId="anonymous-test"
      />,
    );
    expect(html).toContain('reference-workspace');
    expect(html).toContain('reference-sidebar');
    expect(html).toContain('reference-map-stage');
    expect(html).not.toContain('reference-itinerary-float');
  });
});
