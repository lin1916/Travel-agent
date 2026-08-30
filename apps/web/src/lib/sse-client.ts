export interface SseEvent<T> { id?: string; event?: string; data: T }

export interface SseOptions { signal?: AbortSignal; lastEventId?: string; maxReconnects?: number; retryDelayMs?: number }

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(finish, delayMs);
    function finish() { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); }
    signal.addEventListener('abort', finish, { once: true });
  });
}

export function connectSse<T>(url: string, onEvent: (event: SseEvent<T>) => void, options: SseOptions = {}): () => void {
  const controller = new AbortController();
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let lastEventId = options.lastEventId;
  const maxReconnects = options.maxReconnects ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 250;

  async function consume(response: Response): Promise<void> {
    if (!response.ok || !response.body) throw new Error('SSE connection unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const messages = buffer.split(/\r?\n\r?\n/);
      buffer = messages.pop() ?? '';
      for (const message of messages) {
        const lines = message.split(/\r?\n/);
        const id = lines.find(line => line.startsWith('id:'))?.slice(3).trim();
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (id) lastEventId = id;
        if (data) {
          try { onEvent({ id, event, data: JSON.parse(data) as T }); } catch { /* ignore malformed public events */ }
        }
      }
    }
  }

  void (async () => {
    for (let reconnects = 0; !controller.signal.aborted && reconnects <= maxReconnects; reconnects += 1) {
      try {
        const headers = new Headers({ accept: 'text/event-stream' });
        if (lastEventId) headers.set('last-event-id', lastEventId);
        await consume(await fetch(url, { headers, credentials: 'include', signal: controller.signal }));
      } catch { /* reconnect only while this view remains active */ }
      if (!controller.signal.aborted && reconnects < maxReconnects) await waitForRetry(retryDelayMs, controller.signal);
    }
  })();
  return () => controller.abort();
}
