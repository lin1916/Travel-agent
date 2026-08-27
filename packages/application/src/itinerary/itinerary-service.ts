import type { ItineraryItem } from '@travel/contracts';
import { findDirectOverlaps } from '@travel/domain';

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
