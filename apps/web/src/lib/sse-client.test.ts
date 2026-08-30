import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectSse } from './sse-client';

const encoder = new TextEncoder();

function eventStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(value));
      controller.close();
    },
  });
}

describe('connectSse', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reconnects with the latest event cursor after a stream closes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(eventStream('id: event-41\ndata: {"status":"updated"}\n\n')))
      .mockResolvedValueOnce(new Response(eventStream('data: {"status":"complete"}\n\n')));
    vi.stubGlobal('fetch', fetchMock);
    const received: Array<{ id?: string; data: { status: string } }> = [];

    const disconnect = connectSse<{ status: string }>('/api/v1/events', event => received.push(event), {
      lastEventId: 'event-40',
      maxReconnects: 1,
      retryDelayMs: 0,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    disconnect();

    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('last-event-id')).toBe('event-40');
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('last-event-id')).toBe('event-41');
    expect(received).toEqual([{ id: 'event-41', data: { status: 'updated' } }, { data: { status: 'complete' } }]);
  });
});
