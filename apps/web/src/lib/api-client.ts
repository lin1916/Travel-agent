import type {
  AppError,
  AgentRunStatus,
  CandidatePlace,
  Conversation,
  ItineraryItem,
  NormalizedOffer,
  OfferKind,
  PlanProposal,
  PlanCommand,
  PlanVersion,
  Place,
  ProposalAcceptanceResult,
  RankedOffer,
  RoutePlan,
  TripRecord,
} from '@travel/contracts';

export interface SearchResult {
  status: 'completed' | 'queued';
  offers: Partial<Record<OfferKind, NormalizedOffer[]>>;
  ranked: Partial<Record<OfferKind, RankedOffer[]>>;
  categories: Partial<Record<OfferKind, { source?: string; updatedAt?: string; warning?: string; retryable: boolean }>>;
  taskId?: string;
}

export interface AgentRunSummary {
  runId: string;
  conversationId?: string;
  tripId?: string;
  status: AgentRunStatus;
  assistantMessage: string;
  missingFields: string[];
  actionRequests: Array<{ kind: string; resourceId: string }>;
  toolCallSummaries: Array<{ toolName: string; risk: string; status: string; resultSummary?: Record<string, unknown>; correlationId: string }>;
  updatedAt: string;
}

export interface MapPublicConfig { jsKey: string; proxyUrl: string }
export interface CandidateList { candidates: CandidatePlace[] }
export interface ConversationPlanState { plan?: PlanVersion; currentVersion: number }
export interface ProposalList { proposal: PlanProposal | null }

export class PublicApiError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.publicMessage);
    this.name = 'PublicApiError';
  }
}

export class ApiClient {
  constructor(private readonly baseUrl = '/api') {}

  private async request<T>(path: string, init: RequestInit = {}, actorId?: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (!['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase())) {
      const { csrfToken } = await this.request<{ csrfToken: string }>('/v1/session/csrf', { cache: 'no-store', signal: init.signal });
      headers.set('x-csrf-token', csrfToken);
    }
    if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (actorId) headers.set('x-actor-id', actorId);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    if (!response.ok) {
      let payload: AppError;
      try {
        payload = await response.json() as AppError;
      } catch {
        payload = {
          code: 'supplier_unavailable',
          httpStatus: response.status,
          retryable: true,
          publicMessage: '服务暂时不可用，请稍后重试。',
          correlationId: 'unknown',
        };
      }
      throw new PublicApiError(payload);
    }
    return response.json() as Promise<T>;
  }

  createTrip(input: { destination: string; startsAt: string; endsAt: string; travelerCount: number; totalBudgetCents?: number }, actorId: string, signal?: AbortSignal) {
    return this.request<TripRecord>('/v1/trips', { method: 'POST', body: JSON.stringify(input), signal, headers: { 'idempotency-key': `web-${crypto.randomUUID()}` } }, actorId);
  }

  search(tripId: string, input: { kind: OfferKind; startsAt: string; endsAt: string; travelers: number }, actorId: string, signal?: AbortSignal) {
    return this.request<SearchResult>(`/v1/trips/${encodeURIComponent(tripId)}/searches`, { method: 'POST', body: JSON.stringify({ kinds: [input.kind], startsAt: input.startsAt, endsAt: input.endsAt, travelers: input.travelers, mode: 'value' }), signal }, actorId);
  }

  startAgent(input: { tripId?: string; conversationId?: string; userMessage: string }, actorId: string, signal?: AbortSignal) {
    return this.request<AgentRunSummary>('/v1/agent/runs', { method: 'POST', body: JSON.stringify(input), signal }, actorId);
  }

  getAgentRun(runId: string, signal?: AbortSignal) {
    return this.request<AgentRunSummary>(`/v1/agent/runs/${encodeURIComponent(runId)}`, { signal });
  }

  getItinerary(tripId: string, actorId: string, signal?: AbortSignal) {
    return this.request<{ items: ItineraryItem[]; warnings: Array<{ code: string; message: string; severity: string }> }>(`/v1/trips/${encodeURIComponent(tripId)}/itinerary`, { signal }, actorId);
  }

  createConversation(input: { tripId?: string } = {}, signal?: AbortSignal) {
    return this.request<Conversation>('/v1/conversations', { method: 'POST', body: JSON.stringify(input), signal });
  }

  getConversation(id: string, signal?: AbortSignal) {
    return this.request<Conversation>(`/v1/conversations/${encodeURIComponent(id)}`, { signal });
  }

  appendConversationMessage(id: string, content: string, clientMessageId: string = crypto.randomUUID(), signal?: AbortSignal) {
    return this.request<Conversation>(`/v1/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, clientMessageId }),
      signal,
    });
  }

  deleteConversation(id: string, signal?: AbortSignal) {
    return this.request<{ deleted: boolean }>(`/v1/conversations/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
  }

  getCandidates(conversationId: string, signal?: AbortSignal) {
    return this.request<CandidateList>(`/v1/conversations/${encodeURIComponent(conversationId)}/candidates`, { signal });
  }

  searchConversationPlaces(conversationId: string, query: string, signal?: AbortSignal) {
    return this.request<{ places: Place[] }>(`/v1/conversations/${encodeURIComponent(conversationId)}/places/search?query=${encodeURIComponent(query)}`, { signal });
  }

  addCandidate(conversationId: string, place: Place, input: { note?: string; priority?: number } = {}, signal?: AbortSignal) {
    return this.request<CandidatePlace>(`/v1/conversations/${encodeURIComponent(conversationId)}/candidates`, {
      method: 'POST',
      body: JSON.stringify({ place, source: 'user_search', ...input }),
      signal,
    });
  }

  updateCandidate(conversationId: string, candidateId: string, input: { note?: string; priority?: number }, signal?: AbortSignal) {
    return this.request<CandidatePlace>(`/v1/conversations/${encodeURIComponent(conversationId)}/candidates/${encodeURIComponent(candidateId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      signal,
    });
  }

  removeCandidate(conversationId: string, candidateId: string, signal?: AbortSignal) {
    return this.request<{ deleted: boolean }>(`/v1/conversations/${encodeURIComponent(conversationId)}/candidates/${encodeURIComponent(candidateId)}`, { method: 'DELETE', signal });
  }

  async getCurrentProposal(conversationId: string, signal?: AbortSignal): Promise<PlanProposal | undefined> {
    const result = await this.request<PlanProposal | ProposalList>(`/v1/conversations/${encodeURIComponent(conversationId)}/plan-proposals/current`, { signal });
    return 'proposal' in result ? result.proposal ?? undefined : result;
  }

  acceptProposalPlace(conversationId: string, proposalId: string, placeId: string, expectedProposalVersion: number, signal?: AbortSignal) {
    return this.request<CandidatePlace>(`/v1/conversations/${encodeURIComponent(conversationId)}/plan-proposals/${encodeURIComponent(proposalId)}/places/${encodeURIComponent(placeId)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ expectedProposalVersion }),
      signal,
    });
  }

  acceptProposal(conversationId: string, proposalId: string, input: { expectedProposalVersion: number; expectedPlanningContextVersion: number; expectedPlanVersion: number }, signal?: AbortSignal) {
    return this.request<ProposalAcceptanceResult>(`/v1/conversations/${encodeURIComponent(conversationId)}/plan-proposals/${encodeURIComponent(proposalId)}/accept`, {
      method: 'POST',
      headers: { 'idempotency-key': `proposal-${proposalId}-${crypto.randomUUID()}` },
      body: JSON.stringify(input),
      signal,
    });
  }

  rejectProposal(conversationId: string, proposalId: string, expectedProposalVersion: number, signal?: AbortSignal) {
    return this.request<PlanProposal>(`/v1/conversations/${encodeURIComponent(conversationId)}/plan-proposals/${encodeURIComponent(proposalId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ expectedProposalVersion }),
      signal,
    });
  }

  getMapPublicConfig(signal?: AbortSignal) {
    return this.request<MapPublicConfig>('/v1/map/public-config', { signal });
  }

  searchPlaces(tripId: string, query: string, actorId: string, signal?: AbortSignal) {
    return this.request<{ places: Place[] }>(`/v1/trips/${encodeURIComponent(tripId)}/places?query=${encodeURIComponent(query)}`, { signal }, actorId);
  }

  planRoute(tripId: string, input: { mode: 'walk' | 'transit' | 'drive'; origin: { latitude: number; longitude: number; coordinateSystem: 'GCJ-02' }; destination: { latitude: number; longitude: number; coordinateSystem: 'GCJ-02' }; originPlaceId?: string; destinationPlaceId?: string }, actorId: string, signal?: AbortSignal) {
    return this.request<RoutePlan>(`/v1/trips/${encodeURIComponent(tripId)}/routes`, { method: 'POST', body: JSON.stringify(input), signal }, actorId);
  }

  planConversationRoute(conversationId: string, input: Parameters<ApiClient['planRoute']>[1], signal?: AbortSignal) {
    return this.request<RoutePlan>(`/v1/conversations/${encodeURIComponent(conversationId)}/routes`, { method: 'POST', body: JSON.stringify(input), signal });
  }

  async getConversationPlan(conversationId: string, signal?: AbortSignal): Promise<ConversationPlanState> {
    const result = await this.request<PlanVersion | { plan: PlanVersion | null; currentVersion?: number }>(`/v1/conversations/${encodeURIComponent(conversationId)}/plan`, { signal });
    if ('plan' in result) {
      return { ...(result.plan ? { plan: result.plan } : {}), currentVersion: result.currentVersion ?? result.plan?.version ?? 1 };
    }
    return { plan: result, currentVersion: result.version };
  }

  getCurrentPlan(tripId: string, actorId: string, signal?: AbortSignal) {
    return this.request<PlanVersion>(`/v1/trips/${encodeURIComponent(tripId)}/plans/current`, { signal }, actorId);
  }

  undoConversationPlan(conversationId: string, expectedVersion: number, signal?: AbortSignal) {
    return this.request<PlanVersion>(`/v1/conversations/${encodeURIComponent(conversationId)}/plan/undo`, {
      method: 'POST', body: JSON.stringify({ expectedVersion }), signal,
    });
  }

  executePlanCommand(tripId: string, expectedVersion: number, command: PlanCommand, actorId: string, signal?: AbortSignal) {
    return this.request<PlanVersion>(`/v1/trips/${encodeURIComponent(tripId)}/plans/commands`, { method: 'POST', body: JSON.stringify({ expectedVersion, command }), signal, headers: { 'idempotency-key': `plan-${tripId}-${expectedVersion}-${crypto.randomUUID()}` } }, actorId);
  }

  undoPlan(tripId: string, expectedVersion: number, actorId: string, signal?: AbortSignal) {
    return this.request<PlanVersion>(`/v1/trips/${encodeURIComponent(tripId)}/plans/undo`, { method: 'POST', body: JSON.stringify({ expectedVersion }), signal }, actorId);
  }
}

export const apiClient = new ApiClient();
