import { describe, expect, it } from 'vitest';
import type { ItineraryItem } from '@travel/contracts';
import { findDirectOverlaps } from '../src/itinerary/overlap.js';
import { validateTrip } from '../src/trip/trip.js';

function item(id: string, startsAt: string, endsAt: string): ItineraryItem {
  return {
    id,
    version: 1,
    tripId: 'trip-1',
    category: 'attraction',
    startsAt,
    endsAt,
    confirmed: true,
  };
}

describe('findDirectOverlaps', () => {
  it('allows a hotel stay to coexist with daytime activities in either insertion order', () => {
    const stay = { ...item('hotel', '2026-10-01T14:00:00+08:00', '2026-10-04T12:00:00+08:00'), category: 'stay' as const };
    const activity = item('museum', '2026-10-02T09:00:00+08:00', '2026-10-02T11:00:00+08:00');
    expect(findDirectOverlaps([stay], activity)).toEqual([]);
    expect(findDirectOverlaps([activity], stay)).toEqual([]);
  });

  it('still detects overlapping hotel stays and transport/activity conflicts', () => {
    const stay = { ...item('hotel', '2026-10-01T14:00:00+08:00', '2026-10-04T12:00:00+08:00'), category: 'stay' as const };
    expect(findDirectOverlaps([stay], { ...stay, id: 'other-hotel' })).toHaveLength(1);
    const activity = item('museum', '2026-10-02T09:00:00+08:00', '2026-10-02T11:00:00+08:00');
    expect(findDirectOverlaps([activity], { ...activity, id: 'transfer', category: 'transport' })).toHaveLength(1);
  });

  it('uses half-open intervals so touching items are allowed', () => {
    const existing = item('a', '2026-09-01T01:00:00.000Z', '2026-09-01T02:00:00.000Z');
    const candidate = item('b', '2026-09-01T02:00:00.000Z', '2026-09-01T03:00:00.000Z');
    expect(findDirectOverlaps([existing], candidate)).toEqual([]);
  });

  it('blocks direct overlap with confirmed items only', () => {
    const existing = item('a', '2026-09-01T01:00:00.000Z', '2026-09-01T03:00:00.000Z');
    const candidate = item('b', '2026-09-01T02:00:00.000Z', '2026-09-01T04:00:00.000Z');
    expect(findDirectOverlaps([existing], candidate)).toEqual([
      {
        candidateId: 'b',
        existingId: 'a',
        startsAt: '2026-09-01T02:00:00.000Z',
        endsAt: '2026-09-01T03:00:00.000Z',
      },
    ]);
    expect(findDirectOverlaps([{ ...existing, confirmed: false }], candidate)).toEqual([]);
  });
});

describe('trip validation', () => {
  const validTrip = {
    destination: '杭州',
    startsAt: '2026-09-01T09:00:00+08:00',
    endsAt: '2026-09-03T09:00:00+08:00',
    travelerCount: 2,
  };

  it('requires a mainland-China destination, CST timestamps, and integer traveler count', () => {
    expect(() => validateTrip({ ...validTrip, destination: 'Tokyo' })).toThrow('mainland China');
    expect(() => validateTrip({ ...validTrip, startsAt: '2026-09-01T09:00:00+09:00' })).toThrow('China Standard Time');
    expect(() => validateTrip({ ...validTrip, travelerCount: 1.5 })).toThrow('integer');
  });
});
