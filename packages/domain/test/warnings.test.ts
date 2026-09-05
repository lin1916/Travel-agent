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
  it('does not treat a multi-night stay as a transfer predecessor or a daytime activity', async () => {
    const activities = [9, 11, 13, 15].map(hour => item(`activity-${hour}`, 'attraction', `2026-10-02T${String(hour).padStart(2, '0')}:00:00+08:00`, `2026-10-02T${hour + 1}:00:00+08:00`));
    const warnings = await buildSoftWarnings([
      item('hotel', 'stay', '2026-10-02T08:00:00+08:00', '2026-10-04T12:00:00+08:00'),
      ...activities,
    ], { estimate: async () => ({ minutes: 30 }) });
    expect(warnings).toEqual([]);
  });

  it('emits transport advance warning when cities are missing', async () => {
    const warnings = await buildSoftWarnings([
      { ...item('activity', 'attraction', '2026-09-01T01:00:00.000Z', '2026-09-01T02:00:00.000Z'), location: undefined },
      { ...item('transport', 'transport', '2026-09-01T02:30:00.000Z', '2026-09-01T04:00:00.000Z'), location: undefined },
    ], { estimate: async () => ({ minutes: 60 }) });
    expect(warnings.map(warning => warning.code)).toContain('airport_advance');
  });

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
