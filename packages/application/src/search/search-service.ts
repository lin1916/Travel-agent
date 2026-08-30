import type { OfferKind, NormalizedOffer, RankingMode, SearchRequest } from '@travel/contracts';
import type { SupplierAdapter } from '@travel/supplier-adapters';
import { rankOffers } from './ranker.js';

export interface SearchServiceInput { requests: SearchRequest[]; mode?: RankingMode }
export interface CategorySearchResult { source?: string; updatedAt?: string; warning?: string; retryable: boolean }
export interface SearchServiceResult { offers: Partial<Record<OfferKind, NormalizedOffer[]>>; ranked: Partial<Record<OfferKind, ReturnType<typeof rankOffers>>>; categories: Partial<Record<OfferKind, CategorySearchResult>> }

export class SearchService {
  constructor(private readonly adapters: Partial<Record<OfferKind, SupplierAdapter>>) {}

  async search(input: SearchServiceInput | SearchRequest[]): Promise<SearchServiceResult> {
    const requests = Array.isArray(input) ? input : input.requests;
    const mode = Array.isArray(input) ? 'value' : input.mode ?? 'value';
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
        offers[kind] = result.value.page.offers;
        ranked[kind] = rankOffers(result.value.page.offers, mode);
        categories[kind] = { source: result.value.page.source, updatedAt: result.value.page.updatedAt, retryable: false };
      } else {
        const reason = result.reason as { publicMessage?: string; retryable?: boolean };
        offers[kind] = [];
        ranked[kind] = [];
        categories[kind] = { source: this.adapters[kind]?.supplierId, warning: reason.publicMessage ?? (reason instanceof Error ? reason.message : 'supplier search failed'), retryable: reason.retryable ?? true };
      }
    });
    return { offers, ranked, categories };
  }
}
