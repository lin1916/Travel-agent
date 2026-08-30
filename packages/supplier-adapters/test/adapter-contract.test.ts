import { describe, expect, it } from 'vitest';
import type { SearchRequest } from '@travel/contracts';
import {
  MockAttractionAdapter,
  MockDiningAdapter,
  MockStayAdapter,
  MockTransportAdapter,
  faultModes,
} from '../src/index.js';

const request = (kind: SearchRequest['kind']): SearchRequest => ({
  tripId: 'trip-1',
  kind,
  origin: '上海',
  destination: '杭州',
  startsAt: '2026-09-01T09:00:00.000Z',
  endsAt: '2026-09-03T18:00:00.000Z',
  travelers: 2,
});

describe('mock supplier adapter contract', () => {
  it.each([
    ['transport', MockTransportAdapter, 'train'],
    ['stay', MockStayAdapter, 'stay'],
    ['attraction', MockAttractionAdapter, 'attraction'],
    ['dining', MockDiningAdapter, 'dining'],
  ] as const)('%s returns normalized CNY offers with a stable snapshot', async (_name, Adapter, kind) => {
    const adapter = new Adapter();
    const first = await adapter.search(request(kind));
    const second = await adapter.search(request(kind));

    expect(first.offers.length).toBeGreaterThan(0);
    expect(first.source).toMatch(/^mock-/);
    expect(first.updatedAt).toBeTruthy();
    expect(first).toEqual(second);
    expect(first.offers[0]).toMatchObject({
      id: expect.any(String),
      kind,
      supplierId: expect.any(String),
      title: expect.any(String),
      price: { currency: 'CNY', amountCents: expect.any(Number) },
      refundSummary: expect.any(String),
      source: first.source,
      updatedAt: first.updatedAt,
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('retains supplier prompt text as data without interpreting it', async () => {
    const adapter = new MockDiningAdapter('prompt_injection_text');
    const page = await adapter.search(request('dining'));
    expect(page.offers[0].title).toContain('ignore previous instructions');
    expect(page.offers[0]).not.toHaveProperty('tool');
  });

  it('surfaces retryable fault metadata for an unavailable supplier', async () => {
    const adapter = new MockTransportAdapter('inventory_lost');
    await expect(adapter.search(request('train'))).rejects.toMatchObject({ retryable: true, code: 'supplier_unavailable' });
  });

  it('returns normalized flight offers through the transport boundary', async () => {
    const adapter = new MockTransportAdapter();
    const page = await adapter.search({ ...request('train'), kind: 'flight' });
    expect(page.offers.length).toBeGreaterThan(0);
    expect(page.offers[0].kind).toBe('flight');
  });

  it.each([
    ['transport', MockTransportAdapter],
    ['stay', MockStayAdapter],
    ['attraction', MockAttractionAdapter],
    ['dining', MockDiningAdapter],
  ] as const)('%s supports every declared fault mode', async (_name, Adapter) => {
    for (const mode of faultModes) {
      const adapter = new Adapter(mode);
      const kind = adapter.kind === 'train' ? 'train' : adapter.kind;
      if (mode === 'inventory_lost') {
        await expect(adapter.search(request(kind))).rejects.toMatchObject({ code: 'supplier_unavailable' });
        continue;
      }
      const page = await adapter.search(request(kind));
      expect(page.offers[0].price.currency).toBe('CNY');
      if (mode === 'prompt_injection_text') expect(page.offers[0].title).toContain('ignore previous instructions');
      if (mode === 'create_indeterminate') {
        await expect(adapter.createOrder({ intentId: 'i', offerSnapshotHash: page.offers[0].snapshotHash, travelerDataGrantId: 'g', executionAuthorizationRef: 'a', externalIdempotencyKey: 'k' })).resolves.toMatchObject({ outcome: 'indeterminate' });
      }
    }
  });

  it('supports flight requests through the transport adapter', async () => {
    const adapter = new MockTransportAdapter();
    const page = await adapter.search({ ...request('train'), kind: 'flight' });
    expect(page.offers.length).toBeGreaterThan(0);
    expect(page.offers[0].kind).toBe('flight');
  });

  it('keeps expired offers distinguishable by timestamp', async () => {
    const adapter = new MockDiningAdapter('expired_offer');
    const page = await adapter.search(request('dining'));
    expect(page.updatedAt).toMatch(/\+08:00$/);
    expect(page.updatedAt).toContain('2026-01-01');
  });

  it('emits a deterministic webhook regression signal for out-of-order events', async () => {
    const adapter = new MockDiningAdapter('out_of_order_webhook');
    const first = await adapter.parseWebhook({ supplierId: 'mock-dining', rawBody: new Uint8Array(), headers: {} });
    const second = await adapter.parseWebhook({ supplierId: 'mock-dining', rawBody: new Uint8Array(), headers: {} });
    expect(first.lifecycleStatus).toBe('confirmed');
    expect(second.lifecycleStatus).toBe('awaiting_payment');
    expect(first.externalEventId).not.toBe(second.externalEventId);
  });
});
