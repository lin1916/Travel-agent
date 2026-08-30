import { describe, expect, it } from 'vitest';
import type { SearchRequest } from '@travel/contracts';
import { MockDiningAdapter, MockTransportAdapter } from '@travel/supplier-adapters';
import { InMemorySearchTaskQueue, SearchService } from '../src/search/search-service.js';

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

  it('queues deterministic long searches through the durable task boundary', async () => {
    const enqueued: Array<{ id: string; kind: string; payload: unknown }> = [];
    const service = new SearchService({ train: new MockTransportAdapter() }, {
      enqueue: async input => { enqueued.push(input); },
    });
    const result = await service.search({ requests: [
      { ...base, kind: 'train' }, { ...base, kind: 'train' }, { ...base, kind: 'train' }, { ...base, kind: 'train' },
    ] });
    expect(result).toMatchObject({ status: 'queued', taskId: expect.stringMatching(/^search-/) });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].kind).toBe('search');
  });

  it('replays an identical long search with one stable task id', async () => {
    const queue = new InMemorySearchTaskQueue();
    const service = new SearchService({ train: new MockTransportAdapter() }, queue);
    const input = { requests: [
      { ...base, kind: 'train' }, { ...base, kind: 'train' }, { ...base, kind: 'train' }, { ...base, kind: 'train' },
    ] };
    const first = await service.search(input);
    const second = await service.search(input);
    expect(first.taskId).toBe(second.taskId);
    expect(queue.tasks.size).toBe(1);
  });

  it('normalizes search request timestamps to China Standard Time', async () => {
    const seen: string[] = [];
    const adapter = new MockTransportAdapter();
    const originalSearch = adapter.search.bind(adapter);
    adapter.search = async request => { seen.push(request.startsAt); return originalSearch(request); };
    const service = new SearchService({ train: adapter });
    const result = await service.search({ requests: [{ ...base, kind: 'train', startsAt: '2026-09-01T01:00:00.000Z' }] });
    expect(result.categories.train?.updatedAt).toMatch(/\+08:00$/);
    expect(seen[0]).toBe('2026-09-01T09:00:00.000+08:00');
  });
});
