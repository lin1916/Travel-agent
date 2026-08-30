import { SearchRequestSchema, type OfferKind, type NormalizedOffer, type RankingMode, type SearchRequest } from '@travel/contracts';
import type { SupplierAdapter } from '@travel/supplier-adapters';
import { normalizeChinaStandardTime, normalizeOffer } from './normalizer.js';
import { rankOffers } from './ranker.js';

export interface SearchServiceInput { requests: SearchRequest[]; mode?: RankingMode }
export interface CategorySearchResult { source?: string; updatedAt?: string; warning?: string; retryable: boolean }
export interface SearchTaskQueueInput { id: string; kind: 'search'; payload: SearchServiceInput }
export interface SearchTaskQueue { enqueue(input: SearchTaskQueueInput): Promise<void> }
export interface SearchServiceResult { status: 'completed' | 'queued'; taskId?: string; taskKind?: 'search'; offers: Partial<Record<OfferKind, NormalizedOffer[]>>; ranked: Partial<Record<OfferKind, ReturnType<typeof rankOffers>>>; categories: Partial<Record<OfferKind, CategorySearchResult>> }

export class InMemorySearchTaskQueue implements SearchTaskQueue {
  readonly tasks = new Map<string, SearchTaskQueueInput>();
  async enqueue(input: SearchTaskQueueInput): Promise<void> { this.tasks.set(input.id, structuredClone(input)); }
}

export class SearchService {
  constructor(private readonly adapters: Partial<Record<OfferKind, SupplierAdapter>>, private readonly taskQueue?: SearchTaskQueue) {}

  async search(input: SearchServiceInput | SearchRequest[]): Promise<SearchServiceResult> {
    const requests = (Array.isArray(input) ? input : input.requests).map(request => {
      const parsed = SearchRequestSchema.parse(request);
      const normalized = { ...parsed, startsAt: normalizeChinaStandardTime(parsed.startsAt) };
      if (parsed.endsAt !== undefined) normalized.endsAt = normalizeChinaStandardTime(parsed.endsAt);
      return normalized;
    });
    const mode = Array.isArray(input) ? 'value' : input.mode ?? 'value';
    if (requests.length >= 4 && this.taskQueue) {
      const taskId = `search-${Buffer.from(JSON.stringify({ requests, mode })).toString('base64url').slice(0, 40)}`;
      await this.taskQueue.enqueue({ id: taskId, kind: 'search', payload: { requests, mode } });
      return { status: 'queued', taskId, taskKind: 'search', offers: {}, ranked: {}, categories: {} };
    }
    const results = await Promise.allSettled(requests.map(async request => {
      const adapter = this.adapters[request.kind];
      if (!adapter) throw new Error(`no supplier adapter configured for ${request.kind}`);
      return { kind: request.kind, page: await adapter.search(request) };
    }));
    const offers: SearchServiceResult['offers'] = {};
    const ranked: SearchServiceResult['ranked'] = {};
    const categories: SearchServiceResult['categories'] = {};
    results.forEach((result, index) => {
      const kind = requests[index].kind;
      if (result.status === 'fulfilled') {
        const updatedAt = normalizeChinaStandardTime(result.value.page.updatedAt);
        const normalizedOffers = result.value.page.offers.map(offer => normalizeOffer({ ...offer, amountCents: offer.price.amountCents, title: offer.title, refundSummary: offer.refundSummary }, result.value.page.source, offer.updatedAt || updatedAt));
        offers[kind] = normalizedOffers;
        ranked[kind] = rankOffers(normalizedOffers, mode);
        categories[kind] = { source: result.value.page.source, updatedAt, retryable: false };
      } else {
        const reason = result.reason as { publicMessage?: string; retryable?: boolean };
        offers[kind] = [];
        ranked[kind] = [];
        categories[kind] = { source: this.adapters[kind]?.supplierId, warning: reason.publicMessage ?? (reason instanceof Error ? reason.message : 'supplier search failed'), retryable: reason.retryable ?? true };
      }
    });
    return { status: 'completed', offers, ranked, categories };
  }
}
