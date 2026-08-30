import { describe, expect, it } from 'vitest';
import type { SearchRequest } from '@travel/contracts';
import { MockDiningAdapter, MockTransportAdapter } from '@travel/supplier-adapters';
import { SearchService } from '../src/search/search-service.js';

const base: Omit<SearchRequest, 'kind'> = {
  tripId: 'trip-1',
  destination: '杭州',
  startsAt: '2026-09-01T09:00:00.000Z',
  endsAt: '2026-09-03T18:00:00.000Z',
  travelers: 2,
};

describe('SearchService', () => {
  it('isolates category failures while returning successful categories and retryable warnings', async () => {
    const service = new SearchService({
      train: new MockTransportAdapter(),
      dining: new MockDiningAdapter('inventory_lost'),
    });

    const result = await service.search({
      requests: [
        { ...base, kind: 'train' },
        { ...base, kind: 'dining' },
      ],
    });

    expect(result.offers.train.length).toBeGreaterThan(0);
    expect(result.offers.dining).toEqual([]);
    expect(result.categories.dining).toMatchObject({ retryable: true, warning: expect.any(String) });
    expect(result.categories.train).toMatchObject({ source: expect.stringMatching(/^mock-/), updatedAt: expect.any(String) });
  });

  it('ranks normalized offers with explainable factor contributions', async () => {
    const service = new SearchService({ train: new MockTransportAdapter() });
    const result = await service.search({ requests: [{ ...base, kind: 'train' }], mode: 'value' });
    expect(result.ranked.train[0]).toMatchObject({
      factorContributions: expect.objectContaining({ price: expect.any(Number), totalMinutes: expect.any(Number) }),
      reasons: expect.arrayContaining([expect.any(String)]),
    });
  });
});
