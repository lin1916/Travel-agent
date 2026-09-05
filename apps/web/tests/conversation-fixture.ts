import type { Page, Route } from '@playwright/test';

const place = (id: string, name: string, latitude: number, longitude: number) => ({
  id,
  name,
  category: 'attraction',
  address: '杭州市西湖区',
  city: '杭州',
  latitude,
  longitude,
  location: { latitude, longitude, coordinateSystem: 'GCJ-02' },
  coordinateSystem: 'gcj02',
  provider: 'amap',
  providerPlaceId: id,
  sourceUpdatedAt: '2026-09-03T00:00:00+08:00',
});

const places = [place('place-west-lake', '西湖', 30.244, 120.149), place('place-lingyin', '灵隐寺', 30.231, 120.101)];

function context(version: number, complete: boolean) {
  const hasDestinationAndDates = version >= 2;
  const isComplete = complete || version >= 3;
  return {
    conversationId: 'conversation-1',
    version,
    ...(hasDestinationAndDates ? { destination: '杭州', startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00' } : {}),
    ...(isComplete ? { travelerCount: 2, totalBudgetCents: 500_000 } : {}),
    preferences: isComplete ? ['人文景点', '本地餐馆'] : [],
    assumptions: [],
    missingFields: isComplete ? [] : hasDestinationAndDates ? ['travelerCount'] : ['destination', 'startsAt', 'endsAt', 'travelerCount'],
    updatedAt: '2026-09-03T00:00:00+08:00',
  };
}

function plan(version: number, command: 'accept_proposal' | 'calculate' | 'undo' = 'accept_proposal') {
  return {
    id: `plan-${version}`,
    tripId: 'trip-hz-001',
    version,
    createdAt: '2026-09-03T00:00:00+08:00',
    items: [{
      id: 'item-west-lake',
      category: 'attraction',
      title: '西湖慢游',
      startsAt: '2026-10-02T10:00:00+08:00',
      endsAt: '2026-10-02T12:00:00+08:00',
      location: { city: '杭州', latitude: 30.244, longitude: 120.149 },
      estimatedCostCents: 0,
      priceScope: 'group',
      locked: false,
    }],
    warnings: [],
    budget: {
      limit: { amountCents: 500_000, currency: 'CNY' },
      estimatedTotal: { amountCents: 0, currency: 'CNY' },
      groupTotal: { amountCents: 0, currency: 'CNY' },
      perPerson: { amountCents: 0, currency: 'CNY' },
      byCategory: {},
      utilizationPercent: 0,
      warnings: [],
    },
    changeSet: { command, summary: command === 'undo' ? '已撤销上次调整' : command === 'accept_proposal' ? '已接受杭州行程提案' : '已更新行程', changedItemIds: ['item-west-lake'] },
  };
}

function proposal(id: string) {
  return {
    id,
    conversationId: 'conversation-1',
    tripId: 'trip-hz-001',
    version: 1,
    planningContextVersion: 3,
    proposedPlaces: places,
    itinerary: [{
      category: 'attraction',
      title: '西湖慢游',
      startsAt: '2026-10-02T10:00:00+08:00',
      endsAt: '2026-10-02T12:00:00+08:00',
      location: { city: '杭州', latitude: 30.244, longitude: 120.149 },
      estimatedCostCents: 0,
      priceScope: 'group',
    }],
    budgetSummary: plan(1).budget,
    warnings: [],
    reasoningSummary: '已综合地点距离、预算和轻松节奏整理草案。',
    status: 'pending',
    createdAt: '2026-09-03T00:00:00+08:00',
    expiresAt: '2026-09-04T00:00:00+08:00',
  };
}

function conversation(id: string, messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>, version: number, tripId?: string) {
  return {
    id,
    providerName: 'fixture',
    model: 'fixture',
    status: 'active',
    messages,
    ...(tripId ? { tripId, agentRunId: `run-${version}` } : {}),
    planningContext: context(version, Boolean(tripId)),
    createdAt: '2026-09-03T00:00:00+08:00',
    updatedAt: '2026-09-03T00:00:00+08:00',
    expiresAt: '2026-09-10T00:00:00+08:00',
  };
}

export async function installConversationFixture(page: Page) {
  const unhandled: string[] = [];
  const messageCalls: Array<{ content: string; clientMessageId?: string }> = [];
  const sseLastEventIds: string[] = [];
  let conversationId = 'conversation-1';
  let messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }> = [];
  let contextVersion = 1;
  let tripId: string | undefined;
  let savedCandidates: Array<Record<string, unknown>> = [];
  let currentProposal: Record<string, unknown> | undefined;
  let formalPlan: Record<string, unknown> | undefined;
  let deleted = false;
  let nextMessage = 1;

  const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const currentConversation = () => conversation(conversationId, messages, contextVersion, tripId);

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();

    if (method === 'GET' && path === '/v1/session/csrf') return reply(route, { csrfToken: 'fixture-csrf-token' });
    if (method === 'POST' && path === '/v1/conversations') {
      conversationId = conversationId === 'conversation-1' && deleted ? 'conversation-2' : conversationId;
      messages = [];
      contextVersion = 1;
      tripId = undefined;
      savedCandidates = [];
      currentProposal = undefined;
      formalPlan = undefined;
      nextMessage = 1;
      return reply(route, conversation(conversationId, messages, contextVersion));
    }
    if (method === 'GET' && /^\/v1\/conversations\/[^/]+$/.test(path)) return reply(route, currentConversation());
    if (method === 'DELETE' && /^\/v1\/conversations\/[^/]+$/.test(path)) {
      deleted = true;
      return reply(route, { deleted: true });
    }
    if (method === 'POST' && /^\/v1\/conversations\/[^/]+\/messages$/.test(path)) {
      const input = request.postDataJSON() as { content: string; clientMessageId?: string };
      messageCalls.push(input);
      const createdAt = `2026-09-03T00:00:0${nextMessage}+08:00`;
      const user = { id: `user-${nextMessage}`, role: 'user' as const, content: input.content, createdAt };
      const assistant = { id: `assistant-${nextMessage}`, role: 'assistant' as const, content: '', createdAt: `2026-09-03T00:00:1${nextMessage}+08:00` };
      if (input.content.includes('10 月')) {
        contextVersion = 2;
        assistant.content = '我先记录杭州和日期，请再告诉我出行人数。';
      } else if (input.content.includes('两个人')) {
        contextVersion = 3;
        tripId = 'trip-hz-001';
        assistant.content = '信息完整，我已整理好一份待确认的杭州行程提案。';
        currentProposal = proposal('proposal-1');
      } else {
        contextVersion = 4;
        tripId = 'trip-hz-001';
        assistant.content = '好的，我会把第二天调整得更轻松，并生成新的待确认提案。';
        currentProposal = proposal('proposal-2');
      }
      messages = [...messages, user, { ...assistant }];
      nextMessage += 1;
      return reply(route, currentConversation(), 201);
    }
    if (method === 'GET' && /^\/v1\/conversations\/[^/]+\/events$/.test(path)) {
      sseLastEventIds.push(request.headers()['last-event-id'] ?? '');
      const body = !request.headers()['last-event-id']
        ? 'id: event-7\nevent: ReasoningSummaryUpdated\ndata: {"event_id":"event-7","event_type":"ReasoningSummaryUpdated","redacted_payload":{"summary":"已整理地点、预算和游玩节奏"}}\n\n'
        : '';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
    }
    if (method === 'GET' && /^\/v1\/conversations\/[^/]+\/candidates$/.test(path)) return reply(route, { candidates: savedCandidates });
    if (method === 'POST' && /^\/v1\/conversations\/[^/]+\/candidates$/.test(path)) {
      const input = request.postDataJSON() as { place: Record<string, unknown> };
      const candidate = { id: `candidate-${savedCandidates.length + 1}`, conversationId, place: input.place, source: 'user_search', createdAt: '2026-09-03T00:00:00+08:00' };
      savedCandidates = [...savedCandidates, candidate];
      return reply(route, candidate, 201);
    }
    if (method === 'PATCH' && /^\/v1\/conversations\/[^/]+\/candidates\/[^/]+$/.test(path)) return reply(route, savedCandidates[0]);
    if (method === 'DELETE' && /^\/v1\/conversations\/[^/]+\/candidates\/[^/]+$/.test(path)) {
      savedCandidates = savedCandidates.slice(1);
      return reply(route, { deleted: true });
    }
    if (method === 'GET' && /^\/v1\/conversations\/[^/]+\/places\/search$/.test(path)) return reply(route, { places });
    if (method === 'POST' && /^\/v1\/conversations\/[^/]+\/routes$/.test(path)) {
      const input = request.postDataJSON() as { origin: Record<string, unknown>; destination: Record<string, unknown>; mode: string };
      return reply(route, { ...input, originPlaceId: 'place-west-lake', destinationPlaceId: 'place-lingyin', provider: 'amap', updatedAt: '2026-09-03T00:00:00+08:00', status: 'unavailable', reason: 'fixture route unavailable' });
    }
    if (method === 'GET' && /^\/v1\/conversations\/[^/]+\/plan-proposals\/current$/.test(path)) return reply(route, { proposal: currentProposal ?? null });
    if (method === 'POST' && /^\/v1\/conversations\/[^/]+\/plan-proposals\/[^/]+\/places\/[^/]+\/accept$/.test(path)) {
      const placeId = path.split('/').at(-2);
      const selected = places.find(item => item.id === placeId) ?? places[0];
      const candidate = { id: `candidate-${savedCandidates.length + 1}`, conversationId, place: selected, source: 'accepted_agent_proposal', createdAt: '2026-09-03T00:00:00+08:00' };
      savedCandidates = [...savedCandidates, candidate];
      return reply(route, candidate);
    }
    if (method === 'POST' && /^\/v1\/conversations\/[^/]+\/plan-proposals\/[^/]+\/accept$/.test(path)) {
      formalPlan = plan(2);
      currentProposal = undefined;
      const acceptedCandidates = places.map((item, index) => ({ id: `candidate-${index + 2}`, conversationId, place: item, source: 'accepted_agent_proposal', createdAt: '2026-09-03T00:00:00+08:00' }));
      savedCandidates = [...savedCandidates, ...acceptedCandidates];
      return reply(route, { proposal: { ...(proposal('proposal-1')), status: 'accepted', version: 2 }, planVersion: formalPlan, candidates: savedCandidates });
    }
    if (method === 'POST' && /^\/v1\/conversations\/[^/]+\/plan-proposals\/[^/]+\/reject$/.test(path)) {
      currentProposal = undefined;
      return reply(route, { ...proposal('proposal-1'), status: 'rejected', version: 2 });
    }
    if (method === 'POST' && /^\/v1\/conversations\/[^/]+\/plan\/undo$/.test(path)) {
      const input = request.postDataJSON() as { expectedVersion: number };
      if (input.expectedVersion !== formalPlan?.version) return reply(route, { publicMessage: '版本冲突' }, 409);
      formalPlan = { ...plan(input.expectedVersion + 1, 'undo'), items: [] };
      return reply(route, formalPlan);
    }
    if (method === 'GET' && /^\/v1\/conversations\/[^/]+\/plan$/.test(path)) return reply(route, { plan: formalPlan ?? null, currentVersion: formalPlan?.version ?? 1 });
    if (method === 'GET' && /^\/v1\/agent\/runs\/[^/]+$/.test(path)) return reply(route, { runId: `run-${contextVersion}`, conversationId, tripId, status: 'completed', assistantMessage: messages.at(-1)?.content ?? '', missingFields: [], actionRequests: [], toolCallSummaries: [{ toolName: 'search_places', risk: 'read', status: 'completed', resultSummary: { source: 'fixture' }, correlationId: 'corr-1' }], updatedAt: '2026-09-03T00:00:00+08:00' });
    if (method === 'GET' && path === '/v1/map/public-config') return reply(route, { jsKey: '', proxyUrl: '/_AMapService' });

    unhandled.push(`${method} ${path}`);
    return reply(route, { code: 'unhandled_fixture_request', publicMessage: 'fixture request was not handled' }, 599);
  });

  return { unhandled, messageCalls, sseLastEventIds, state: () => ({ conversationId, savedCandidates, currentProposal, formalPlan, deleted }) };
}
