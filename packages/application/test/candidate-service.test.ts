import { describe, expect, it } from 'vitest';
import { CandidateSourceSchema, type Place } from '@travel/contracts';
import {
  CandidateService,
  InMemoryCandidateRepository,
} from '../src/candidates/candidate-service.js';
import { ApplicationError } from '../src/errors.js';

const place: Place = {
  id: 'B000A1B2C3',
  name: '西湖',
  category: '景点',
  address: '浙江省杭州市西湖区',
  city: '杭州',
  latitude: 30.244,
  longitude: 120.149,
  location: { latitude: 30.244, longitude: 120.149, coordinateSystem: 'GCJ-02' },
  coordinateSystem: 'gcj02',
  provider: 'amap',
  providerPlaceId: 'B000A1B2C3',
  sourceUpdatedAt: '2026-09-03T00:00:00.000Z',
};

function candidateService() {
  let sequence = 0;
  return new CandidateService(
    new InMemoryCandidateRepository(),
    {
      assertOwned: async (sessionId: string, conversationId: string) => {
        if (sessionId !== 'session-1' || conversationId !== 'conversation-1') {
          throw new ApplicationError('forbidden', 'conversation belongs to another session');
        }
      },
    },
    { now: () => new Date('2026-09-03T00:00:00.000Z'), id: () => `candidate-${++sequence}` },
  );
}

describe('CandidateService', () => {
  it('stores a manually accepted map result before a Trip exists', async () => {
    const service = candidateService();
    const saved = await service.add('session-1', 'conversation-1', {
      place,
      source: 'user_search',
    });

    expect(saved.conversationId).toBe('conversation-1');
    expect(saved).not.toHaveProperty('tripId');
    await expect(service.list('session-1', 'conversation-1')).resolves.toEqual([saved]);
  });

  it('does not expose an operation that saves an unaccepted agent suggestion', () => {
    expect(CandidateSourceSchema.options).toEqual(['user_search', 'accepted_agent_proposal']);
  });

  it('deduplicates manually accepted places by provider place identity', async () => {
    const service = candidateService();
    const first = await service.add('session-1', 'conversation-1', { place, source: 'user_search' });
    const duplicate = await service.add('session-1', 'conversation-1', {
      place: { ...place, name: '西湖景区' },
      source: 'user_search',
    });

    expect(duplicate).toEqual(first);
    await expect(service.list('session-1', 'conversation-1')).resolves.toEqual([first]);
  });

  it('updates priority and removes only the selected candidate', async () => {
    const service = candidateService();
    const saved = await service.add('session-1', 'conversation-1', { place, source: 'user_search' });

    await expect(service.setPriority('session-1', 'conversation-1', saved.id, 3)).resolves.toMatchObject({ priority: 3 });
    await service.remove('session-1', 'conversation-1', saved.id);

    await expect(service.list('session-1', 'conversation-1')).resolves.toEqual([]);
  });

  it('uses Conversation ownership and deletes candidates with the Conversation', async () => {
    const service = candidateService();
    await service.add('session-1', 'conversation-1', { place, source: 'user_search' });

    await expect(service.list('session-2', 'conversation-1')).rejects.toMatchObject({ code: 'forbidden' });
    await service.deleteConversation('session-1', 'conversation-1');

    await expect(service.list('session-1', 'conversation-1')).resolves.toEqual([]);
  });
});
