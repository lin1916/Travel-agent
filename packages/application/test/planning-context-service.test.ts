import { describe, expect, it } from 'vitest';
import {
  InMemoryPlanningContextRepository,
  PlanningContextService,
} from '../src/planning-context/planning-context-service.js';
import {
  ConversationService,
  InMemoryConversationRepository,
} from '../src/conversations/conversation-service.js';
import { ApplicationError } from '../src/errors.js';

function planningContextService() {
  return new PlanningContextService(
    new InMemoryPlanningContextRepository(),
    conversationOwnership({ 'conversation-1': 'session-1' }),
  );
}

function conversationOwnership(owners: Record<string, string>, now = '2026-09-03T00:00:00.000Z') {
  return {
    now: () => new Date(now),
    assertOwned: async (sessionId: string, conversationId: string) => {
      if (owners[conversationId] !== sessionId) {
        throw new ApplicationError('forbidden', 'conversation belongs to another session');
      }
    },
  };
}

describe('PlanningContextService', () => {
  it('merges model patches under optimistic version control', async () => {
    const service = planningContextService();
    const initial = await service.initialize('session-1', 'conversation-1');

    const updated = await service.applyPatch('session-1', 'conversation-1', {
      destination: '杭州',
      startsAt: '2026-10-01T00:00:00+08:00',
      endsAt: '2026-10-04T00:00:00+08:00',
      travelerCount: 2,
      totalBudgetCents: 500_000,
      preferences: ['人文景点', '本地餐馆'],
    }, initial.version);

    expect(updated).toMatchObject({
      version: 2,
      destination: '杭州',
      travelerCount: 2,
      missingFields: [],
    });
  });

  it('does not produce a Trip draft until required values or an explicit one-person assumption exist', async () => {
    const service = planningContextService();
    const initial = await service.initialize('session-1', 'conversation-1');
    const partial = await service.applyPatch('session-1', 'conversation-1', {
      destination: '杭州',
      startsAt: '2026-10-01T00:00:00+08:00',
      endsAt: '2026-10-04T00:00:00+08:00',
    }, initial.version);

    expect(service.tripDraft(partial)).toBeUndefined();
    expect(partial.missingFields).toEqual(['travelerCount']);
  });

  it('uses the explicit one-person assumption when producing a Trip draft', async () => {
    const service = planningContextService();
    const initial = await service.initialize('session-1', 'conversation-1');
    const updated = await service.applyPatch('session-1', 'conversation-1', {
      destination: '杭州',
      startsAt: '2026-10-01T00:00:00+08:00',
      endsAt: '2026-10-04T00:00:00+08:00',
      totalBudgetCents: 500_000,
      assumptions: ['traveler_count_defaulted_to_1'],
    }, initial.version);

    expect(service.tripDraft(updated)).toEqual({
      destination: '杭州',
      startsAt: '2026-10-01T00:00:00+08:00',
      endsAt: '2026-10-04T00:00:00+08:00',
      travelerCount: 1,
      totalBudgetCents: 500_000,
    });
    expect(updated.missingFields).toEqual([]);
  });

  it('rejects access from another anonymous session', async () => {
    const service = planningContextService();
    await service.initialize('session-1', 'conversation-1');

    await expect(service.get('session-2', 'conversation-1')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.applyPatch('session-2', 'conversation-1', { destination: '杭州' }, 1)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.delete('session-2', 'conversation-1')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects a context claim from a session that does not own the conversation', async () => {
    const repository = new InMemoryPlanningContextRepository();
    const service = new PlanningContextService(
      repository,
      conversationOwnership({ 'conversation-1': 'session-1' }),
    );

    await expect(service.initialize('session-2', 'conversation-1')).rejects.toMatchObject({ code: 'forbidden' });
    expect(await repository.get('conversation-1')).toBeUndefined();
  });

  it('uses ConversationService as the authoritative ownership port', async () => {
    const conversations = new ConversationService(
      new InMemoryConversationRepository(),
      { run: async () => ({ assistantMessage: 'unused' }) },
      { now: () => new Date('2026-09-03T00:00:00.000Z'), id: () => 'conversation-1' },
    );
    const conversation = await conversations.create('session-1', {
      providerName: 'test-provider',
      model: 'test-model',
    });
    const planning = new PlanningContextService(
      new InMemoryPlanningContextRepository(),
      conversations,
    );

    await expect(planning.initialize('session-2', conversation.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(planning.initialize('session-1', conversation.id)).resolves.toMatchObject({
      conversationId: 'conversation-1',
      version: 1,
    });
  });

  it('returns one atomically created context to concurrent initializations', async () => {
    const repository = new InMemoryPlanningContextRepository();
    const firstService = new PlanningContextService(
      repository,
      conversationOwnership({ 'conversation-1': 'session-1' }, '2026-09-03T00:00:00.000Z'),
      { now: () => new Date('2026-09-03T00:00:00.000Z') },
    );
    const secondService = new PlanningContextService(
      repository,
      conversationOwnership({ 'conversation-1': 'session-1' }, '2026-09-03T00:00:01.000Z'),
      { now: () => new Date('2026-09-03T00:00:01.000Z') },
    );

    const [first, second] = await Promise.all([
      firstService.initialize('session-1', 'conversation-1'),
      secondService.initialize('session-1', 'conversation-1'),
    ]);

    expect(first).toEqual(second);
    expect(await firstService.get('session-1', 'conversation-1')).toEqual(first);
  });

  it('rejects patches with an invalid trip interval', async () => {
    const service = planningContextService();
    const initial = await service.initialize('session-1', 'conversation-1');

    await expect(service.applyPatch('session-1', 'conversation-1', {
      destination: '杭州',
      startsAt: '2026-10-04T00:00:00+08:00',
      endsAt: '2026-10-01T00:00:00+08:00',
      travelerCount: 2,
    }, initial.version)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects non-CST timestamps before a context is complete', async () => {
    const startsAtService = planningContextService();
    const startsAtInitial = await startsAtService.initialize('session-1', 'conversation-1');
    await expect(startsAtService.applyPatch('session-1', 'conversation-1', {
      startsAt: '2026-10-01T00:00:00Z',
    }, startsAtInitial.version)).rejects.toMatchObject({ code: 'validation_error' });

    const endsAtService = planningContextService();
    const endsAtInitial = await endsAtService.initialize('session-1', 'conversation-1');
    await expect(endsAtService.applyPatch('session-1', 'conversation-1', {
      endsAt: '2026-10-04T00:00:00+09:00',
    }, endsAtInitial.version)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects traveler counts outside the allowed range', async () => {
    const service = planningContextService();
    const initial = await service.initialize('session-1', 'conversation-1');

    await expect(service.applyPatch('session-1', 'conversation-1', { travelerCount: 0 }, initial.version)).rejects.toMatchObject({ code: 'validation_error' });
    await expect(service.applyPatch('session-1', 'conversation-1', { travelerCount: 7 }, initial.version)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects a negative total budget', async () => {
    const service = planningContextService();
    const initial = await service.initialize('session-1', 'conversation-1');

    await expect(service.applyPatch('session-1', 'conversation-1', { totalBudgetCents: -1 }, initial.version)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('removes duplicate preferences while retaining their first occurrence', async () => {
    const service = planningContextService();
    const initial = await service.initialize('session-1', 'conversation-1');

    const updated = await service.applyPatch('session-1', 'conversation-1', {
      preferences: ['人文景点', '本地餐馆', '人文景点'],
    }, initial.version);

    expect(updated.preferences).toEqual(['人文景点', '本地餐馆']);
  });

  it('rejects a patch based on a stale planning context version', async () => {
    const service = planningContextService();
    const initial = await service.initialize('session-1', 'conversation-1');
    await service.applyPatch('session-1', 'conversation-1', { destination: '杭州' }, initial.version);

    await expect(service.applyPatch('session-1', 'conversation-1', { origin: '上海' }, initial.version)).rejects.toMatchObject({ code: 'conflict' });
  });
});
