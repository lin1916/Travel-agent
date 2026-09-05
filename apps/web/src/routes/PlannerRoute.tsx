import { useEffect, useState } from 'react';
import type { Conversation } from '@travel/contracts';
import { ChatPanel } from '../features/chat/ChatPanel';
import { TravelMap } from '../features/map/TravelMap';
import { ConversationWorkspace, CONVERSATION_REFERENCE_KEY } from '../features/session/ConversationWorkspace';
import { ApiClient, PublicApiError } from '../lib/api-client';

const client = new ApiClient();

function storedConversationId(): string | undefined {
  try {
    const value = sessionStorage.getItem(CONVERSATION_REFERENCE_KEY);
    if (!value) return undefined;
    const reference = JSON.parse(value) as { conversationId?: unknown };
    return typeof reference.conversationId === 'string' && reference.conversationId ? reference.conversationId : undefined;
  } catch {
    return undefined;
  }
}

function saveConversationId(id: string): void {
  try {
    const existing = sessionStorage.getItem(CONVERSATION_REFERENCE_KEY);
    const reference = existing ? JSON.parse(existing) as { lastEventId?: unknown } : {};
    sessionStorage.setItem(CONVERSATION_REFERENCE_KEY, JSON.stringify({ conversationId: id, ...(typeof reference.lastEventId === 'string' ? { lastEventId: reference.lastEventId } : {}) }));
  } catch { /* optional browser storage */ }
}

function BootstrapShell() {
  return <main className="reference-workspace reference-landing conversation-bootstrap" aria-label="旅行规划工作台">
    <div className="reference-layout">
      <aside className="reference-sidebar" aria-label="旅行助手对话">
        <div className="reference-sidebar__brand"><span className="reference-live-dot" title="规划服务在线" /><div><strong>Voyager Agent</strong><span>先聊旅行，再决定行程</span></div></div>
        <ChatPanel />
      </aside>
      <section className="reference-map-stage" aria-label="地点探索工作区">
        <TravelMap />
        <div className="reference-map-search map-search section-block"><label htmlFor="bootstrap-place-search">搜索地点</label><div><span className="reference-search-icon" aria-hidden="true">⌕</span><input id="bootstrap-place-search" aria-label="搜索地点" placeholder="搜索景点、餐厅或酒店" /><span className="muted">正在连接</span></div></div>
      </section>
    </div>
  </main>;
}

export function PlannerRoute() {
  const [conversation, setConversation] = useState<Conversation>();
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    async function bootstrap() {
      try {
        const id = storedConversationId();
        const current = id ? await client.getConversation(id).catch(() => undefined) : undefined;
        const next = current ?? await client.createConversation();
        if (disposed) return;
        saveConversationId(next.id);
        setConversation(next);
      } catch (requestError) {
        if (!disposed) setError(requestError instanceof PublicApiError ? requestError.message : '暂时无法连接规划服务，请稍后重试。');
      }
    }
    void bootstrap();
    return () => { disposed = true; };
  }, []);

  if (!conversation) return <><BootstrapShell />{error && <p className="bootstrap-error" role="alert">{error}</p>}</>;
  return <ConversationWorkspace initialConversation={conversation} client={client} />;
}
