import type { AppError, AgentRunStatus, NormalizedOffer, RankedOffer, TripRecord, ItineraryItem, OfferKind } from '@travel/contracts';

export interface SearchResult {
  status: 'completed' | 'queued';
  offers: Partial<Record<OfferKind, NormalizedOffer[]>>;
  ranked: Partial<Record<OfferKind, RankedOffer[]>>;
  categories: Partial<Record<OfferKind, { source?: string; updatedAt?: string; warning?: string; retryable: boolean }>>;
  taskId?: string;
}

export interface AgentRunSummary {
  runId: string;
  tripId: string;
  status: AgentRunStatus;
  assistantMessage: string;
  missingFields: string[];
  actionRequests: Array<{ kind: string; resourceId: string }>;
  toolCallSummaries: Array<{ toolName: string; risk: string; status: string; resultSummary?: Record<string, unknown>; correlationId: string }>;
  updatedAt: string;
}

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
    headers.set('content-type', 'application/json');
    if (actorId) headers.set('x-actor-id', actorId);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    if (!response.ok) {
      let payload: AppError;
      try { payload = await response.json() as AppError; } catch { payload = { code: 'supplier_unavailable', httpStatus: response.status, retryable: true, publicMessage: '服务暂时不可用，请稍后重试。', correlationId: 'unknown' }; }
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

  startAgent(input: { tripId: string; userMessage: string }, actorId: string, signal?: AbortSignal) {
    return this.request<AgentRunSummary>('/v1/agent/runs', { method: 'POST', body: JSON.stringify(input), signal }, actorId);
  }

  getItinerary(tripId: string, actorId: string, signal?: AbortSignal) {
    return this.request<{ items: ItineraryItem[]; warnings: Array<{ code: string; message: string; severity: string }> }>(`/v1/trips/${encodeURIComponent(tripId)}/itinerary`, { signal }, actorId);
  }
}

export const apiClient = new ApiClient();
