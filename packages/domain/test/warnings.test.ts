import { describe, expect, it } from 'vitest';
import type { ItineraryItem } from '@travel/contracts';
import { buildSoftWarnings } from '../src/itinerary/warnings.js';

const item = (
  id: string,
  category: ItineraryItem['category'],
  startsAt: string,
  endsAt: string,
): ItineraryItem => ({
  id,
  tripId: 'trip-1',
  version: 1,
  category,
  startsAt,
  endsAt,
  location: { city: '杭州' },
  confirmed: true,
});

describe('soft itinerary warnings', () => {
  it('warns for tight transfer and transport advance without blocking', async () => {
    const warnings = await buildSoftWarnings(
      [
        item('activity', 'attraction', '2026-09-01T01:00:00.000Z', '2026-09-01T02:00:00.000Z'),
        item('transport', 'transport', '2026-09-01T02:30:00.000Z', '2026-09-01T04:00:00.000Z'),
      ],
      { estimate: async () => ({ minutes: 60 }) },
    );
    expect(warnings.map(warning => warning.code)).toEqual([
      'transfer_tight',
      'airport_advance',
    ]);
  });
});
