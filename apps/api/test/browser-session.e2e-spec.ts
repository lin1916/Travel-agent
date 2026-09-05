import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createFastifySecurityHook } from '@travel/security';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { LocalPlanningAppModule } from '../src/local-planning-app.module.js';

let app: NestFastifyApplication;
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('LOCAL_PLANNING_MEMORY_MODE', 'true');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('TRAVEL_AGENT_RUNTIME', 'legacy');
  vi.stubEnv('TRAVEL_LLM_API_KEY', 'test-only');
  const module = await Test.createTestingModule({ imports: [LocalPlanningAppModule] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.getHttpAdapter().getInstance().addHook('onRequest', createFastifySecurityHook());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });

it('bootstraps browser CSRF protection before creating a cookie-owned Conversation', async () => {
  const server = app.getHttpAdapter().getInstance();
  const bootstrap = await server.inject({ method: 'GET', url: '/v1/session/csrf', headers: { 'sec-fetch-site': 'same-origin' } });
  expect(bootstrap.statusCode).toBe(200);
  expect(bootstrap.headers['cache-control']).toBe('no-store');
  const token = bootstrap.json().csrfToken;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  const cookie = String(bootstrap.headers['set-cookie']);
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  const headers = { origin: 'http://localhost:5173', cookie: cookie.split(';')[0]!, 'content-type': 'application/json' };
  expect((await server.inject({ method: 'POST', url: '/v1/conversations', headers, payload: '{}' })).statusCode).toBe(403);
  expect((await server.inject({ method: 'POST', url: '/v1/conversations', headers: { ...headers, 'x-csrf-token': 'wrong' }, payload: '{}' })).statusCode).toBe(403);
  const created = await server.inject({ method: 'POST', url: '/v1/conversations', headers: { ...headers, 'x-csrf-token': token }, payload: '{}' });
  expect(created.statusCode).toBe(201);
  expect(created.json().id).toBeTruthy();
  expect(created.headers['set-cookie']).toContain('travel_session=');
  const refresh = await server.inject({ method: 'GET', url: '/v1/session/csrf', headers: { cookie: headers.cookie } });
  expect(refresh.json().csrfToken).toBe(token);
});
