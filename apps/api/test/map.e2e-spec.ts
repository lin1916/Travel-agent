import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { MapController, MapPublicController } from '../src/modules/map/map.controller.js';
import { ApplicationError, MapService } from '@travel/application';
import { TRIP_SERVICE } from '../src/modules/trips/trip.providers.js';
import { AMapJsProxy } from '../src/modules/map/amap-client.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import { AMapClient, type MapHttpResponse } from '../src/modules/map/amap-client.js';

function response(body: unknown, status = 200): MapHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('AMap map capability', () => {
  it('exercises controller routes, ownership checks, and public proxy configuration', async () => {
    const calls: string[] = [];
    const module = await Test.createTestingModule({
      controllers: [MapController, MapPublicController],
      providers: [
        { provide: MapService, useValue: { searchPlaces: async () => { calls.push('places'); return []; }, planRoute: async (value: unknown) => { calls.push('route'); return value; } } },
        { provide: TRIP_SERVICE, useValue: { get: async (_id: string, owner: string) => { if (owner !== 'owner') throw new ApplicationError('forbidden'); return {}; } } },
        { provide: AMapJsProxy, useValue: { forward: async () => response({ ok: true }) } },
      ],
    }).compile();
    const app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await request(app.getHttpServer()).get('/v1/map/public-config').expect(200).expect({ jsKey: '', proxyUrl: '/_AMapService' });
    await request(app.getHttpServer()).get('/v1/trips/t1/places?query=杭州').set('x-actor-id', 'owner').expect(200);
    await request(app.getHttpServer()).post('/v1/trips/t1/routes').set('x-actor-id', 'other').send({ mode: 'walk', origin: { latitude: 30, longitude: 120 }, destination: { latitude: 30.1, longitude: 120.1 } }).expect(403);
    expect(calls).toEqual(['places']);
    await app.close();
  });

  it('keeps the web service key server-side and encodes provider queries', async () => {
    let requested = '';
    const client = new AMapClient({
      key: 'server-secret',
      baseUrl: 'https://amap.test',
      transport: async url => {
        requested = url;
        return response({ status: '1', pois: [{ id: 'P1', name: '西湖', type: '景点', cityname: '杭州', address: '西湖', location: '120.149,30.244' }] });
      },
    });
    const places = await client.searchPlaces('西湖 & 湖滨');
    expect(places[0]).toMatchObject({ id: 'P1', provider: 'amap', providerPlaceId: 'P1', latitude: 30.244, longitude: 120.149, coordinateSystem: 'gcj02' });
    expect(requested).toContain('key=server-secret');
    expect(requested).toContain('keywords=%E8%A5%BF%E6%B9%96+%26+%E6%B9%96%E6%BB%A8');
  });

  it('normalizes walking, transit, and driving responses and explicit unavailable routes', async () => {
    const paths = ['/v5/direction/walking', '/v5/direction/transit/integrated', '/v5/direction/driving'];
    const client = new AMapClient({
      key: 'key',
      baseUrl: 'https://amap.test',
      transport: async url => {
        expect(paths.some(path => url.includes(path))).toBe(true);
        return response({ status: '1', route: { paths: [{ distance: '1000', duration: '600' }], transits: [{ distance: '2000', duration: '1200' }] } });
      },
    });
    for (const mode of ['walk', 'transit', 'drive'] as const) {
      await expect(client.planRoute({
        mode,
        origin: { latitude: 30, longitude: 120, coordinateSystem: 'GCJ-02' },
        destination: { latitude: 30.1, longitude: 120.1, coordinateSystem: 'GCJ-02' },
      })).resolves.toMatchObject({ status: 'available', mode, distanceMeters: expect.any(Number), durationMinutes: expect.any(Number), provider: 'amap' });
    }
    const unavailable = new AMapClient({ key: 'key', transport: async () => response({ status: '1', route: {} }) });
    await expect(unavailable.planRoute({
      mode: 'drive',
      origin: { latitude: 30, longitude: 120, coordinateSystem: 'GCJ-02' },
      destination: { latitude: 30.1, longitude: 120.1, coordinateSystem: 'GCJ-02' },
    })).resolves.toMatchObject({ status: 'unavailable', reason: expect.any(String) });
  });

  it('redacts timeout and provider failures and rejects missing configuration', async () => {
    const timeout = new AMapClient({ key: 'secret', timeoutMs: 1, transport: async (_url, init) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (init?.signal?.aborted) throw new Error('request timeout key=secret');
      return response({ status: '1', pois: [] });
    } });
    const error = await timeout.searchPlaces('杭州').catch(value => value as Error);
    expect(error.message).not.toContain('secret');

    const missing = new AMapClient({ key: '', transport: async () => response({ status: '1', pois: [] }) });
    await expect(missing.searchPlaces('杭州')).rejects.toMatchObject({ code: 'supplier_unavailable' });
  });

  it('enforces HTTPS host allowlists and bounded timeouts on the JS proxy', async () => {
    let requested = '';
    const proxy = new AMapJsProxy({
      securityCode: 'server-secret',
      baseUrl: 'http://evil.example',
      transport: async url => { requested = url; return response({ ok: true }); },
    });
    await expect(proxy.forward('/service', { query: 'x' })).rejects.toMatchObject({ code: 'supplier_unavailable' });
    expect(requested).toBe('');
  });
});
