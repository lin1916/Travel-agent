export interface SseEvent<T> { id?: string; event?: string; data: T }

export function connectSse<T>(url: string, onEvent: (event: SseEvent<T>) => void, options: { signal?: AbortSignal; lastEventId?: string } = {}): () => void {
  const controller = new AbortController();
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const headers = new Headers({ accept: 'text/event-stream' });
  if (options.lastEventId) headers.set('last-event-id', options.lastEventId);
  void fetch(url, { headers, credentials: 'include', signal: controller.signal }).then(async response => {
    if (!response.ok || !response.body) return;
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
        if (data) {
          try { onEvent({ id, event, data: JSON.parse(data) as T }); } catch { /* ignore malformed public events */ }
        }
      }
    }
  }).catch(() => undefined);
  return () => controller.abort();
}
