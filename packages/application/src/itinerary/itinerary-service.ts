import type { ItineraryItem } from '@travel/contracts';
import { buildSoftWarnings, findDirectOverlaps } from '@travel/domain';
import type { RouteEstimator } from '@travel/contracts';
import type { ItineraryRepository } from '@travel/persistence';

export class ItineraryService {
  private readonly items = new Map<string, ItineraryItem[]>();

  add(item: ItineraryItem): ItineraryItem {
    const existing = this.items.get(item.tripId) ?? [];
    if (item.confirmed && findDirectOverlaps(existing, item).length > 0) {
      throw new Error('itinerary item overlaps a confirmed item');
    }
    this.items.set(item.tripId, [...existing, structuredClone(item)]);
    return structuredClone(item);
  }

  list(tripId: string): ItineraryItem[] {
    return structuredClone(this.items.get(tripId) ?? []);
  }
}

export class PersistentItineraryService {
  constructor(private readonly store: ItineraryRepository, private readonly routeEstimator: RouteEstimator) {}
  async add(item: ItineraryItem): Promise<ItineraryItem> {
    const existing = await this.store.list(item.tripId);
    if (item.confirmed && findDirectOverlaps(existing, item).length > 0) throw new Error('itinerary item overlaps a confirmed item');
    return this.store.add(item);
  }
  async list(tripId: string): Promise<{ items: ItineraryItem[]; warnings: Awaited<ReturnType<typeof buildSoftWarnings>> }> {
    const items = await this.store.list(tripId);
    return { items, warnings: await buildSoftWarnings(items, this.routeEstimator) };
  }
}
