import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MapService } from '@travel/application';
import { LocalPlanningAppModule } from '../src/local-planning-app.module.js';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';

const place = {
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
  sourceUpdatedAt: '2026-09-04T00:00:00.000Z',
};

describe('conversation-scoped map and candidate APIs', () => {
  let app: INestApplication;
  const searchQueries: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [LocalPlanningAppModule] })
      .overrideProvider(MapService)
      .useValue({ searchPlaces: async (query: string) => { searchQueries.push(query); return [place]; }, planRoute: async (value: unknown) => value })
      .compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => { await app?.close(); });

  it('lets a cookie-owned no-Trip conversation search and manage only its own candidates', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const conversationId = created.body.id as string;

    const search = await request(app.getHttpServer())
      .get(`/v1/conversations/${conversationId}/places/search?query=${encodeURIComponent('西湖')}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(search.body.places).toEqual([place]);
    expect(searchQueries.at(-1)).toBe('西湖');
    await request(app.getHttpServer()).get(`/v1/conversations/${conversationId}/places/search?query= `).set('Cookie', cookie).expect(400);

    const added = await request(app.getHttpServer())
      .post(`/v1/conversations/${conversationId}/candidates`)
      .set('Cookie', cookie)
      .send({ place, source: 'user_search', note: '日落前去', priority: 2 })
      .expect(201);
    expect(added.body).toMatchObject({ conversationId, place, source: 'user_search', note: '日落前去', priority: 2 });

    await request(app.getHttpServer())
      .get(`/v1/conversations/${conversationId}/candidates`)
      .set('Cookie', cookie)
      .expect(200)
      .expect({ candidates: [added.body] });

    const patched = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conversationId}/candidates/${added.body.id}`)
      .set('Cookie', cookie)
      .send({ note: '傍晚去', priority: 1 })
      .expect(200);
    expect(patched.body).toMatchObject({ id: added.body.id, place, source: 'user_search', note: '傍晚去', priority: 1 });

    await request(app.getHttpServer())
      .post(`/v1/conversations/${conversationId}/candidates`)
      .set('Cookie', cookie)
      .send({ place, source: 'accepted_agent_proposal' })
      .expect(400);

    const other = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const otherCookie = other.headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer())
      .get(`/v1/conversations/${conversationId}/candidates`)
      .set('Cookie', otherCookie)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/v1/conversations/${conversationId}/candidates/${added.body.id}`)
      .set('Cookie', cookie)
      .expect(200)
      .expect({ deleted: true });
    await request(app.getHttpServer())
      .get(`/v1/conversations/${conversationId}/candidates`)
      .set('Cookie', cookie)
      .expect(200)
      .expect({ candidates: [] });

    const route = await request(app.getHttpServer())
      .post(`/v1/conversations/${conversationId}/routes`)
      .set('Cookie', cookie)
      .send({ mode: 'walk', origin: place.location, destination: { latitude: 30.25, longitude: 120.15, coordinateSystem: 'GCJ-02' } })
      .expect(201);
    expect(route.body).toMatchObject({ mode: 'walk', origin: place.location });
  });
});
