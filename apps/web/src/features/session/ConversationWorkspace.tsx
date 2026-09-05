import { useEffect, useMemo, useState } from 'react';
import type { Conversation, CandidatePlace, PlanProposal, PlanVersion, Place, RoutePlan } from '@travel/contracts';
import type { AgentRunSummary, ApiClient, MapPublicConfig } from '../../lib/api-client';
import { connectSse, type SseEvent } from '../../lib/sse-client';
import { AgentProgress, type AgentProgressEvent } from '../agent/AgentProgress';
import { CandidatePlaceList } from '../candidates/CandidatePlaceList';
import { ChatPanel } from '../chat/ChatPanel';
import { TravelMap } from '../map/TravelMap';
import { PlaceSearch } from '../map/PlaceSearch';
import { PlanProposalCard } from '../proposals/PlanProposalCard';
import { PlanBudget } from '../plans/PlanBudget';
import { PlanTimeline } from '../plans/PlanTimeline';
import { PlanningContextChips } from './PlanningContextChips';

export const CONVERSATION_REFERENCE_KEY = 'travel-agent.conversation-reference';

type ConversationEventEnvelope = {
  event_type?: string;
  redacted_payload?: Record<string, unknown>;
};

function saveConversationReference(conversationId: string, lastEventId?: string): void {
  try { sessionStorage.setItem(CONVERSATION_REFERENCE_KEY, JSON.stringify({ conversationId, ...(lastEventId ? { lastEventId } : {}) })); } catch { /* optional browser storage */ }
}

function storedLastEventId(conversationId: string): string | undefined {
  try {
    const value = sessionStorage.getItem(CONVERSATION_REFERENCE_KEY);
    if (!value) return undefined;
    const reference = JSON.parse(value) as { conversationId?: unknown; lastEventId?: unknown };
    return reference.conversationId === conversationId && typeof reference.lastEventId === 'string' ? reference.lastEventId : undefined;
  } catch {
    return undefined;
  }
}
type ChatViewMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt?: string; status: 'sent' };

function messagesFor(conversation: Conversation): ChatViewMessage[] {
  return conversation.messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    status: 'sent',
  }));
}

function eventFromSse(event: SseEvent<ConversationEventEnvelope>): AgentProgressEvent | undefined {
  const type = event.data.event_type ?? event.event;
  if (!type) return undefined;
  return { type, payload: event.data.redacted_payload };
}

export function ConversationWorkspace({ initialConversation, client }: { initialConversation: Conversation; client: ApiClient }) {
  const [conversation, setConversation] = useState(initialConversation);
  const [messages, setMessages] = useState<ChatViewMessage[]>(messagesFor(initialConversation));
  const [places, setPlaces] = useState<Place[]>([]);
  const [candidates, setCandidates] = useState<CandidatePlace[]>([]);
  const [proposal, setProposal] = useState<PlanProposal>();
  const [formalPlan, setFormalPlan] = useState<PlanVersion>();
  const [currentPlanVersion, setCurrentPlanVersion] = useState(1);
  const [run, setRun] = useState<AgentRunSummary>();
  const [progressEvents, setProgressEvents] = useState<AgentProgressEvent[]>([]);
  const [mapConfig, setMapConfig] = useState<MapPublicConfig>();
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>();
  const [route, setRoute] = useState<RoutePlan>();
  const [routeError, setRouteError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [draftRequest, setDraftRequest] = useState<{ content: string }>();
  const [tab, setTab] = useState<'chat' | 'map' | 'plan'>('chat');

  async function refreshConversationData(nextConversation?: Conversation) {
    const current = nextConversation ?? await client.getConversation(conversation.id);
    setConversation(current);
    setMessages(messagesFor(current));
    const [candidateResult, proposalResult] = await Promise.allSettled([
      client.getCandidates(current.id),
      client.getCurrentProposal(current.id),
    ]);
    if (candidateResult.status === 'fulfilled') setCandidates(candidateResult.value.candidates);
    if (proposalResult.status === 'fulfilled') setProposal(proposalResult.value);
    if (current.agentRunId) {
      const latestRun = await client.getAgentRun(current.agentRunId).catch(() => undefined);
      if (latestRun) setRun(latestRun);
    }
    if (current.tripId) {
      const latestPlan = await client.getConversationPlan(current.id).catch(() => undefined);
      if (latestPlan) {
        setCurrentPlanVersion(latestPlan.currentVersion);
        setFormalPlan(latestPlan.plan);
      }
    }
    return current;
  }

  useEffect(() => {
    let disposed = false;
    void Promise.allSettled([
      client.getMapPublicConfig(),
      client.getCandidates(conversation.id),
      client.getCurrentProposal(conversation.id),
    ]).then(results => {
      if (disposed) return;
      const map = results[0];
      const saved = results[1];
      const current = results[2];
      if (map.status === 'fulfilled') setMapConfig(map.value);
      if (saved.status === 'fulfilled') setCandidates(saved.value.candidates);
      if (current.status === 'fulfilled') setProposal(current.value);
    });
    if (conversation.agentRunId) void client.getAgentRun(conversation.agentRunId).then(setRun).catch(() => undefined);
    if (conversation.tripId) void client.getConversationPlan(conversation.id).then(state => { setCurrentPlanVersion(state.currentVersion); setFormalPlan(state.plan); }).catch(() => undefined);
    saveConversationReference(conversation.id, storedLastEventId(conversation.id));
    return () => { disposed = true; };
  }, [client, conversation.id]);

  useEffect(() => {
    const stop = connectSse<ConversationEventEnvelope>(`/api/v1/conversations/${encodeURIComponent(conversation.id)}/events`, event => {
      const progress = eventFromSse(event);
      if (event.id) saveConversationReference(conversation.id, event.id);
      if (progress) setProgressEvents(current => [...current, progress].slice(-30));
      const payload = event.data.redacted_payload ?? {};
      if (progress?.type === 'ConversationMessageCreated') {
        const message = payload.message;
        if (message && typeof message === 'object') {
          const record = message as { id?: unknown; role?: unknown; content?: unknown; createdAt?: unknown };
          if (typeof record.id === 'string' && (record.role === 'user' || record.role === 'assistant') && typeof record.content === 'string') {
            const received: ChatViewMessage = { id: record.id, role: record.role, content: record.content, createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined, status: 'sent' };
            setMessages(current => current.some(item => item.id === received.id) ? current : [...current, received]);
          }
        }
      }
      if (progress?.type === 'PlanProposalCreated' || progress?.type === 'PlanningContextUpdated' || progress?.type === 'AgentMessageCompleted') {
        void refreshConversationData().catch(() => undefined);
      }
    }, { lastEventId: storedLastEventId(conversation.id) });
    return stop;
  }, [conversation.id]);

  useEffect(() => {
    if (places.length < 2) {
      setRoute(undefined);
      setRouteError('');
      return;
    }
    let disposed = false;
    void client.planConversationRoute(conversation.id, {
      mode: 'transit',
      origin: places[0].location,
      destination: places[1].location,
      originPlaceId: places[0].id,
      destinationPlaceId: places[1].id,
    }).then(value => { if (!disposed) { setRoute(value); setRouteError(''); } }).catch(() => { if (!disposed) { setRoute(undefined); setRouteError('路线暂时不可用，请稍后重试。'); } });
    return () => { disposed = true; };
  }, [client, conversation.id, places]);

  async function sendMessage(content: string, clientMessageId: string) {
    setError('');
    const response = await client.appendConversationMessage(conversation.id, content, clientMessageId);
    await refreshConversationData(response);
    return response.messages.at(-1)?.role === 'assistant' ? response.messages.at(-1)?.content : undefined;
  }

  async function refreshCandidates() {
    const result = await client.getCandidates(conversation.id);
    setCandidates(result.candidates);
  }

  async function addCandidate(place: Place) {
    setError('');
    try {
      await client.addCandidate(conversation.id, place);
      await refreshCandidates();
      setNotice(`${place.name} 已加入候选地点。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '暂时无法加入候选地点。');
    }
  }

  async function acceptProposal(result: Awaited<ReturnType<ApiClient['acceptProposal']>>) {
    setFormalPlan(result.planVersion);
    setCurrentPlanVersion(result.planVersion.version);
    setCandidates(current => {
      const byId = new Map(current.map(candidate => [candidate.id, candidate]));
      result.candidates.forEach(candidate => byId.set(candidate.id, candidate));
      return [...byId.values()];
    });
    setProposal(undefined);
    setNotice('行程已接受，正式计划已生成。');
    await refreshConversationData().catch(() => undefined);
  }

  async function deleteConversation() {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      const result = await client.deleteConversation(conversation.id);
      if (!result.deleted) throw new Error('暂时无法清空会话，请重试。');
      try { sessionStorage.removeItem(CONVERSATION_REFERENCE_KEY); } catch { /* optional browser storage */ }
      window.location.reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '暂时无法清空会话，请重试。');
      setDeleting(false);
    }
  }

  async function undoPlan() {
    if (!formalPlan || undoing) return;
    setUndoing(true);
    setError('');
    try {
      const next = await client.undoConversationPlan(conversation.id, formalPlan.version);
      setFormalPlan(next);
      setCurrentPlanVersion(next.version);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '暂时无法撤销，请重试。');
    } finally {
      setUndoing(false);
    }
  }

  const contextVersion = conversation.planningContext?.version ?? proposal?.planningContextVersion ?? 1;
  const planVisible = Boolean(formalPlan);
  const mapPlaces = useMemo(() => places, [places]);

  return <main className="reference-workspace conversation-workspace" aria-labelledby="conversation-workspace-title">
    <div className="reference-layout">
      <aside className={`reference-sidebar workspace-column workspace-column--chat ${tab === 'chat' ? 'is-active' : ''}`} aria-label="旅行助手对话">
        <div className="reference-sidebar__brand"><span className="reference-live-dot" title="规划服务在线" /><div><strong id="conversation-workspace-title">Voyager Agent</strong><span>先聊旅行，再决定行程</span></div><button type="button" className="reference-session-action" data-testid="delete-session" disabled={deleting} onClick={() => void deleteConversation()}>{deleting ? '清空中…' : '清空'}</button></div>
        <PlanningContextChips context={conversation.planningContext} onSelect={label => { setTab('chat'); setDraftRequest({ content: `我想修改「${label}」：` }); }} />
        <ChatPanel initialMessages={messages} onSubmit={sendMessage} draftRequest={draftRequest} />
        <AgentProgress events={progressEvents} run={run} />
        {error && <p className="form-error workspace-error" role="alert">{error}</p>}
        {notice && <p className="workspace-notice" role="status">{notice}</p>}
      </aside>
      <section className={`reference-map-stage workspace-column workspace-column--map ${tab === 'map' ? 'is-active' : ''}`} aria-label="地点探索工作区">
        <TravelMap publicConfig={mapConfig} places={mapPlaces} selectedPlaceId={selectedPlaceId} onSelect={setSelectedPlaceId} route={route} routeUnavailableReason={routeError || (places.length < 2 ? '选择两个地点后可规划路线。' : undefined)} />
        <div className="conversation-map-tools"><PlaceSearch conversationId={conversation.id} client={client} onResults={setPlaces} onAddCandidate={addCandidate} /><CandidatePlaceList conversationId={conversation.id} candidates={candidates} client={client} onChange={refreshCandidates} /></div>
      </section>
      {(proposal || formalPlan) && <aside className={`reference-itinerary-float workspace-column workspace-column--plan ${tab === 'plan' ? 'is-active' : ''}`} aria-label={proposal ? '行程提案' : '正式行程'}>
        {proposal && <PlanProposalCard conversationId={conversation.id} proposal={proposal} contextVersion={contextVersion} planVersion={currentPlanVersion} client={client} onAccepted={acceptProposal} onChanged={async () => { setProposal(await client.getCurrentProposal(conversation.id)); await refreshCandidates(); }} />}
        {formalPlan && <div className="formal-plan"><div className="reference-float-heading"><div><span className="eyebrow">已接受的计划</span><h2>行程时间线</h2></div><span className="reference-float-count">v{formalPlan.version}</span></div><PlanTimeline plan={formalPlan} onUndo={undoPlan} busy={undoing} /><PlanBudget budget={formalPlan.budget} /></div>}
      </aside>}
    </div>
    <nav className="bottom-nav workspace-tabs" aria-label="工作台导航"><button type="button" className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}>聊天</button><button type="button" className={tab === 'map' ? 'is-active' : ''} onClick={() => setTab('map')}>地图</button><button type="button" className={`${tab === 'plan' ? 'is-active' : ''} ${!planVisible && !proposal ? 'is-disabled' : ''}`} disabled={!planVisible && !proposal} onClick={() => setTab('plan')}>行程</button></nav>
  </main>;
}
