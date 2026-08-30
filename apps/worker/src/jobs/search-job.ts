import type { NormalizedOffer, TaskOutcome } from '@travel/contracts';
import type { SearchService, SearchServiceInput } from '@travel/application';
import type { TaskHandler, TaskRecord } from '../task-runner.js';

export interface SearchResultStore {
  saveSearchResult(taskId: string, tripId: string, offers: readonly NormalizedOffer[]): Promise<void>;
}

export class SearchJob implements TaskHandler {
  readonly kind = 'search' as const;
  constructor(private readonly search: SearchService, private readonly results: SearchResultStore) {}
  async handle(task: TaskRecord): Promise<TaskOutcome> {
    if (!task.payload || typeof task.payload !== 'object' || !Array.isArray((task.payload as { requests?: unknown }).requests)) {
      throw new Error('search task payload is invalid');
    }
    const input = task.payload as SearchServiceInput;
    const tripIds = new Set(input.requests.map(request => request.tripId));
    if (tripIds.size !== 1) throw new Error('search task must target exactly one Trip');
    const tripId = input.requests[0]?.tripId;
    if (!tripId) throw new Error('search task requires requests');
    const result = await this.search.search(input);
    if (result.status !== 'completed') throw new Error('worker search unexpectedly re-queued');
    const offers = Object.values(result.offers).flatMap(group => group ?? []);
    await this.results.saveSearchResult(task.id, tripId, offers);
    return { status: 'completed' };
  }
}
