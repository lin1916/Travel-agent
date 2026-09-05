import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client';

afterEach(() => vi.unstubAllGlobals());

it('bootstraps CSRF and attaches it only to the subsequent mutation', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(url.endsWith('/session/csrf') ? { csrfToken: 'test-token' } : { id: 'conversation-1' }));
  });
  const api = new ApiClient();
  await expect(api.createConversation()).resolves.toMatchObject({ id: 'conversation-1' });
  expect(requests.map(request => request.url)).toEqual(['/api/v1/session/csrf', '/api/v1/conversations']);
  expect(requests[0]!.init?.cache).toBe('no-store');
  expect(new Headers(requests[1]!.init?.headers).get('x-csrf-token')).toBe('test-token');
  expect(requests.every(request => request.init?.credentials === 'include')).toBe(true);
  requests.length = 0;
  await api.getConversation('conversation-1');
  expect(requests).toHaveLength(1);
  expect(new Headers(requests[0]!.init?.headers).has('x-csrf-token')).toBe(false);
});
