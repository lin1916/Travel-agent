import { describe, expect, it } from 'vitest';
import type { MapProvider, Place, RoutePlan } from '@travel/contracts';
import { ApplicationError } from '../src/errors.js';
import { MapService } from '../src/map/map-service.js';

const place: Place = {
  id: 'B000A1B2C3',
  name: '西湖',
  category: '景点',
  address: '浙江省杭州市西湖区',
  city: '杭州',
  latitude: 30.244,
  longitude: 120.149,
  location: { latitude: 30.244, longitude: 120.149, coordinateSystem: 'GCJ-02' },
  coordinateSystem: 'gcj02',
  provider: 'amap',
  providerPlaceId: 'B000A1B2C3',
  sourceUpdatedAt: '2026-09-02T00:00:00.000Z',
};

function provider(overrides: Partial<MapProvider> = {}): MapProvider {
  return {
    searchPlaces: async () => [place],
    geocode: async () => place.location,
    planRoute: async ({ mode }) => ({
      mode,
      status: 'available',
      origin: { latitude: 30.2, longitude: 120.1 },
      destination: { latitude: 30.3, longitude: 120.2 },
      distanceMeters: 1000,
      durationMinutes: 10,
      polyline: null,
      estimatedCostCents: null,
      originPlaceId: 'origin',
      destinationPlaceId: 'destination',
      provider: 'amap',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }),
    ...overrides,
  };
}

describe('MapService', () => {
  it('normalizes places and route modes at the application boundary', async () => {
    const service = new MapService(provider());
    await expect(service.searchPlaces('杭州西湖')).resolves.toEqual([place]);
    await expect(service.planRoute({
      mode: 'walk',
      origin: place.location,
      destination: { latitude: 30.3, longitude: 120.2 },
    })).resolves.toMatchObject({ mode: 'walk', status: 'available', distanceMeters: 1000, durationMinutes: 10 });
  });

  it('rejects coordinates outside the valid geographic range', async () => {
    const service = new MapService(provider());
    await expect(service.geocode('杭州')).resolves.toEqual(place.location);
    await expect(service.planRoute({
      mode: 'drive',
      origin: { latitude: 91, longitude: 120 },
      destination: place.location,
    })).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('returns an explicit unavailable route without invented distance or duration', async () => {
    const service = new MapService(provider({
      planRoute: async ({ mode }) => ({
        mode,
        status: 'unavailable',
        origin: place.location,
        destination: place.location,
        reason: 'no transit route',
        originPlaceId: 'origin',
        destinationPlaceId: 'destination',
        provider: 'amap',
        updatedAt: '2026-09-02T00:00:00.000Z',
      }),
    }));
    const result = await service.planRoute({ mode: 'transit', origin: place.location, destination: place.location });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'no transit route' });
    expect(result).not.toHaveProperty('distanceMeters');
    expect(result).not.toHaveProperty('durationSeconds');
  });

  it('redacts provider timeout and network details as a retryable application error', async () => {
    const service = new MapService(provider({
      searchPlaces: async () => { throw new Error('timeout contacting amap with key=secret'); },
    }));
    const error = await service.searchPlaces('杭州').catch(value => value as ApplicationError);
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.code).toBe('supplier_unavailable');
    expect(error.message).not.toContain('secret');
    expect(error.detail.internalDetail).toContain('timeout contacting amap');
  });
});
