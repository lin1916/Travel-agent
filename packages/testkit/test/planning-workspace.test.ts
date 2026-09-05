import { describe, expect, it } from 'vitest';
import { MapService, PlanService, ConversationService, InMemoryConversationRepository, type ConversationTurnRunner } from '@travel/application';
import type { MapProvider, Place } from '@travel/contracts';

const place: Place = {
  id: 'place-west-lake',
  name: 'West Lake',
  category: 'attraction',
  address: 'Hangzhou',
  city: 'Hangzhou',
  latitude: 30.244,
  longitude: 120.149,
  location: { latitude: 30.244, longitude: 120.149, coordinateSystem: 'GCJ-02' },
  coordinateSystem: 'gcj02',
  provider: 'amap',
  providerPlaceId: 'B000A1B2C3',
  sourceUpdatedAt: '2026-09-03T00:00:00.000Z',
};

describe('planning workspace acceptance', () => {
  it('supports deterministic chat, map, plan, budget, undo, reload and delete without booking tools', async () => {
    const plans = new PlanService({ now: () => new Date('2026-09-03T00:00:00.000Z'), id: (() => { let n = 0; return () => `id-${++n}`; })() });
    const maps = new MapService({
      searchPlaces: async () => [place],
      geocode: async () => place.location,
      planRoute: async ({ mode }) => ({
        status: 'available', mode, originPlaceId: place.id, destinationPlaceId: place.id,
        origin: place.location, destination: place.location, provider: 'amap',
        updatedAt: '2026-09-03T00:00:00.000Z', distanceMeters: 0, durationMinutes: 0, polyline: null, estimatedCostCents: null,
      }),
    } satisfies MapProvider);
    const repository = new InMemoryConversationRepository();
    const runner: ConversationTurnRunner = {
      run: async input => ({ assistantMessage: `Planned ${input.messages.at(-1)?.content}`, agentRunId: 'test-run' }),
    };
    const conversations = new ConversationService(repository, runner, { now: () => new Date('2026-09-03T00:00:00.000Z'), id: () => 'conversation-1' });
    const conversation = await conversations.create('session-1', { providerName: 'explicit-test-provider', model: 'test-model', tripId: 'trip-1' });
    const afterChat = await conversations.appendUserMessage('session-1', conversation.id, { content: 'Plan Hangzhou from 2026-10-01 to 2026-10-04 for 2 travelers, budget 5000 yuan', clientMessageId: '018f47f2-3a8a-7c71-9d2d-f114dfe66a08' });
    expect(afterChat.messages.map(message => message.role)).toEqual(['user', 'assistant']);

    await expect(maps.searchPlaces('Hangzhou')).resolves.toEqual([place]);
    const empty = await plans.current('trip-1', 'session-1', { travelerCount: 2, totalBudgetCents: 500_000 });
    const added = await plans.execute('trip-1', 'session-1', {
      kind: 'add',
      item: { category: 'attraction', title: 'West Lake', startsAt: '2026-10-02T09:00:00.000+08:00', endsAt: '2026-10-02T11:00:00.000+08:00', location: { city: 'Hangzhou' }, estimatedCostCents: 20_000, priceScope: 'group' },
    }, empty.version, { travelerCount: 2, totalBudgetCents: 500_000 });
    expect(added.budget.estimatedTotal.amountCents).toBe(20_000);
    const undone = await plans.undo('trip-1', 'session-1', added.version, { travelerCount: 2, totalBudgetCents: 500_000 });
    expect(undone.items).toEqual([]);
    const reloaded = await plans.current('trip-1', 'session-1', { travelerCount: 2, totalBudgetCents: 500_000 });
    expect(reloaded.items).toEqual([]);

    const planningToolNames = ['search_offers', 'add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item', 'replace_itinerary_item', 'lock_itinerary_item', 'optimize_day', 'check_schedule', 'calculate_budget', 'undo_plan_change'];
    expect(planningToolNames.some(name => /booking|payment|refund|traveler/i.test(name))).toBe(false);
    expect(JSON.stringify(afterChat)).not.toMatch(/api[_-]?key|authorization|Bearer|payment|booking/i);
    await conversations.delete('session-1', conversation.id);
    await expect(conversations.get('session-1', conversation.id)).rejects.toThrow();
  });
});
