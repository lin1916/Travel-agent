import { describe, expect, it } from 'vitest';
import { InMemoryTripStore, TripService } from '../src/trips/trip-service.js';
import { ItineraryService } from '../src/itinerary/itinerary-service.js';

describe('application rules', () => {
  it('enforces trip ownership and versioning', async () => {
    const service = new TripService(new InMemoryTripStore());
    const trip = await service.create('owner-1', {
      destination: '杭州',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-03T00:00:00.000Z',
      travelerCount: 2,
    });
    await expect(service.get(trip.id, 'owner-2')).rejects.toMatchObject({ code: 'forbidden' });
    const updated = await service.update(trip.id, 'owner-1', 1, { destination: '苏州' });
    expect(updated.version).toBe(2);
    await expect(service.update(trip.id, 'owner-1', 1, { destination: '南京' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects a directly overlapping confirmed itinerary item', () => {
    const service = new ItineraryService();
    service.add({
      id: 'a',
      version: 1,
      tripId: 'trip-1',
      category: 'attraction',
      startsAt: '2026-09-01T01:00:00.000Z',
      endsAt: '2026-09-01T03:00:00.000Z',
      confirmed: true,
    });
    expect(() =>
      service.add({
        id: 'b',
        version: 1,
        tripId: 'trip-1',
        category: 'dining',
        startsAt: '2026-09-01T02:00:00.000Z',
        endsAt: '2026-09-01T04:00:00.000Z',
        confirmed: true,
      }),
    ).toThrow('itinerary item overlaps a confirmed item');
  });
});
