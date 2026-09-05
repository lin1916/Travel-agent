import { useEffect, useMemo, useState } from 'react';
import type { NormalizedOffer, RankedOffer, OfferKind, PlanCommand, PlanVersion, Place, RoutePlan, PlanItem } from '@travel/contracts';
import type { AgentRunSummary, ApiClient, MapPublicConfig } from '../../lib/api-client';
import { connectSse } from '../../lib/sse-client';
import { ChatPanel } from '../chat/ChatPanel';
import { PlanningDetailsDrawer } from '../chat/PlanningDetailsDrawer';
import { TravelMap } from '../map/TravelMap';
import { OfferComparison } from '../search/OfferComparison';
import { PlanTimeline } from '../plans/PlanTimeline';
import { PlanBudget } from '../plans/PlanBudget';

export interface PlanningWorkspaceData { destination: string; tripId: string; offers: Partial<Record<OfferKind, NormalizedOffer[]>>; ranked: Partial<Record<OfferKind, RankedOffer[]>>; categories: Record<string, { source?: string; updatedAt?: string; warning?: string; retryable: boolean }>; run?: AgentRunSummary; itinerary?: { items: any[]; warnings?: Array<{ message: string; severity: string }> }; totalBudgetCents?: number }
const SESSION_REFERENCE_KEY = 'travel-agent.session-reference';
export function workspaceSessionReference(tripId: string, conversationId: string, lastEventId?: string) { return { tripId, conversationId, ...(lastEventId ? { lastEventId } : {}) }; }
export function mergeConversationMessages(_current: unknown[], incoming: Array<{ id: string; role: string; content: string; createdAt: string }>) { return incoming.map(message => ({ ...message, status: 'sent' as const })); }
export function findDayTwoItem(items: PlanItem[]) { return items.find(item => new Date(item.startsAt).getDate() === 2); }
export function buildDayTwoAdjustment(item: PlanItem): Extract<PlanCommand, { kind: 'move' }> {
  const shift = (value: string) => new Date(new Date(value).getTime() + 60 * 60 * 1000).toISOString();
  return { kind: 'move', itemId: item.id, startsAt: shift(item.startsAt), endsAt: shift(item.endsAt), location: item.location };
}
export function PlanningWorkspace({ data, client, actorId }: { data: PlanningWorkspaceData; client: ApiClient; actorId: string }) {
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<any[]>(data.run?.assistantMessage ? [{ id: 'assistant-start', role: 'assistant', content: data.run.assistantMessage, status: 'sent' }] : []);
  const [config, setConfig] = useState<MapPublicConfig>();
  const [places, setPlaces] = useState<Place[]>([]);
  const [plan, setPlan] = useState<PlanVersion>();
  const [route, setRoute] = useState<RoutePlan>();
  const [routeError, setRouteError] = useState('');
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>();
  const [changeSummary, setChangeSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'chat' | 'map' | 'plan'>('chat');
  const estimated = useMemo(() => Object.values(data.offers).flat().reduce((sum, offer) => sum + (offer?.price.amountCents ?? 0), 0), [data.offers]);

  useEffect(() => {
    void client.getMapPublicConfig().then(setConfig).catch(() => setConfig(undefined));
    void client.getCurrentPlan(data.tripId, actorId).then(setPlan).catch(() => undefined);
    try {
      const raw = sessionStorage.getItem(SESSION_REFERENCE_KEY);
      const reference = raw ? JSON.parse(raw) as { tripId?: string; conversationId?: string; lastEventId?: string } : undefined;
      if (reference?.tripId === data.tripId && reference.conversationId) {
        setConversationId(reference.conversationId);
        void client.getConversation(reference.conversationId).then(conversation => setMessages(mergeConversationMessages(messages, conversation.messages))).catch(() => undefined);
      }
    } catch { /* ignore malformed non-sensitive session reference */ }
  }, [client, data.tripId, actorId]);
  useEffect(() => {
    if (places.length < 2) { setRoute(undefined); setRouteError(''); return; }
    let cancelled = false;
    void client.planRoute(data.tripId, { mode: 'transit', origin: places[0].location, destination: places[1].location, originPlaceId: places[0].id, destinationPlaceId: places[1].id }, actorId).then(value => { if (!cancelled) { setRoute(value); setRouteError(''); } }).catch(() => { if (!cancelled) { setRoute(undefined); setRouteError('路线暂时不可用，请稍后重试。'); } });
    return () => { cancelled = true; };
  }, [client, data.tripId, actorId, places]);
  useEffect(() => { if (!conversationId) return; let reference: { tripId: string; conversationId: string; lastEventId?: string } | undefined; try { reference = JSON.parse(sessionStorage.getItem(SESSION_REFERENCE_KEY) ?? 'null'); } catch { reference = undefined; } return connectSse(`/api/v1/conversations/${encodeURIComponent(conversationId)}/events`, event => { if (event.id) sessionStorage.setItem(SESSION_REFERENCE_KEY, JSON.stringify(workspaceSessionReference(data.tripId, conversationId, event.id))); if (event.event === 'ConversationMessageCreated') { const message = ((event.data as any).redacted_payload as any)?.message; if (message?.role === 'assistant') setMessages(current => current.some(item => item.id === message.id) ? current : [...current, { ...message, status: 'sent' }]); } }, { lastEventId: reference?.lastEventId }); }, [conversationId, data.tripId]);

  async function sendMessage(content: string) {
    let id = conversationId;
    if (!id) { const conversation = await client.createConversation({ tripId: data.tripId }); id = conversation.id; setConversationId(id); sessionStorage.setItem(SESSION_REFERENCE_KEY, JSON.stringify(workspaceSessionReference(data.tripId, id))); }
    const response = await client.appendConversationMessage(id, content);
    setMessages(response.messages.map(message => ({ ...message, status: 'sent' })));
    return response.messages.at(-1)?.role === 'assistant' ? response.messages.at(-1)?.content : undefined;
  }
  async function adjustDayTwo() {
    if (!plan) return;
    const item = findDayTwoItem(plan.items);
    if (!item) { setChangeSummary('第 2 天暂无可调整的安排。'); return; }
    setBusy(true);
    try { const command = buildDayTwoAdjustment(item); const next = await client.executePlanCommand(data.tripId, plan.version, command, actorId); setPlan(next); setChangeSummary(next.changeSet.summary); }
    finally { setBusy(false); }
  }
  async function undo() { if (!plan) return; setBusy(true); try { const next = await client.undoPlan(data.tripId, plan.version, actorId); setPlan(next); setChangeSummary(next.changeSet.summary); } finally { setBusy(false); } }
  async function deleteSession() { if (conversationId) await client.deleteConversation(conversationId).catch(() => undefined); sessionStorage.removeItem('travel-agent.workspace'); sessionStorage.removeItem(SESSION_REFERENCE_KEY); window.location.reload(); }

  const dayTwoAvailable = Boolean(plan && findDayTwoItem(plan.items));
  return <main className="planning-workspace workspace reference-workspace" aria-labelledby="workspace-title">
    <div className="reference-layout">
      <aside className={`reference-sidebar workspace-column workspace-column--chat ${tab === 'chat' ? 'is-active' : ''}`} aria-label="旅行助手对话">
        <div className="reference-sidebar__brand">
          <span className="reference-live-dot" title="规划服务在线" />
          <div><strong id="workspace-title">Voyager</strong><span>{data.destination} · AI 旅行规划</span></div>
          <button type="button" className="reference-session-action" data-testid="delete-session" onClick={() => void deleteSession()}>清空</button>
        </div>
        <ChatPanel initialMessages={messages} onSubmit={sendMessage} onUndo={plan && plan.version > 1 ? undo : undefined} changeSummary={changeSummary} />
        <PlanningDetailsDrawer run={data.run} />
      </aside>
      <section className={`reference-map-stage workspace-column workspace-column--map ${tab === 'map' ? 'is-active' : ''}`} aria-label="地图工作区">
        <TravelMap publicConfig={config} places={places} selectedPlaceId={selectedPlaceId} onSelect={setSelectedPlaceId} route={route} routeUnavailableReason={routeError || (places.length < 2 ? '选择两个地点后可规划路线。' : undefined)} />
        <div className="reference-map-search map-search section-block">
          <label htmlFor="place-search">搜索地点</label>
          <div><span className="reference-search-icon" aria-hidden="true">⌕</span><input id="place-search" placeholder="搜索景点、餐厅或酒店" onKeyDown={event => { if (event.key === 'Enter') void client.searchPlaces(data.tripId, event.currentTarget.value, actorId).then(response => setPlaces(response.places)); }} /><span className="muted">Enter 搜索</span></div>
        </div>
        <div className="reference-results-strip">
          <OfferComparison offers={data.offers} ranked={data.ranked} categories={data.categories as never} />
        </div>
      </section>
      {plan?.items.length ? <aside className={`reference-itinerary-float workspace-column workspace-column--plan ${tab === 'plan' ? 'is-active' : ''}`} aria-label="行程概览">
        <div className="reference-float-heading"><div><span className="eyebrow">行程草案</span><h2>探索路线</h2></div><span className="reference-float-count">{plan.items.length} 个地点</span></div>
        <PlanTimeline plan={plan} onAdjustDayTwo={adjustDayTwo} dayTwoAvailable={dayTwoAvailable} onUndo={plan.version > 1 ? undo : undefined} busy={busy} />
        <PlanBudget budget={plan.budget} fallbackTotalCents={estimated || data.totalBudgetCents} />
      </aside> : null}
    </div>
    <nav className="bottom-nav workspace-tabs" aria-label="工作台导航"><button type="button" className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}>聊天</button><button type="button" className={tab === 'map' ? 'is-active' : ''} onClick={() => setTab('map')}>地图</button><button type="button" className={tab === 'plan' ? 'is-active' : ''} onClick={() => setTab('plan')}>行程</button></nav>
  </main>;
}
