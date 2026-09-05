import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import * as appComposition from '../src/app.module.js';
import * as memoryMode from '../src/local-planning-memory-mode.js';
import { PLANNING_MODEL_FETCH } from '../src/modules/agent/agent.tokens.js';

type EnvironmentDecision = (environment?: NodeJS.ProcessEnv) => boolean;
type RootModuleSelector = (environment?: NodeJS.ProcessEnv) => new (...args: never[]) => unknown;

const shouldRunBootstrapMigrations = (memoryMode as typeof memoryMode & {
  shouldRunBootstrapMigrations?: EnvironmentDecision;
}).shouldRunBootstrapMigrations;

const selectApiRootModule = (appComposition as typeof appComposition & {
  selectApiRootModule?: RootModuleSelector;
}).selectApiRootModule;

describe('local planning memory mode', () => {
  it('is enabled only by the explicit development flag without DATABASE_URL', () => {
    expect(memoryMode.isLocalPlanningMemoryMode({
      NODE_ENV: 'development',
      LOCAL_PLANNING_MEMORY_MODE: 'true',
    })).toBe(true);
    expect(memoryMode.isLocalPlanningMemoryMode({
      NODE_ENV: 'development',
      LOCAL_PLANNING_MEMORY_MODE: 'true',
      DATABASE_URL: '',
    })).toBe(true);
  });

  it('does not weaken production or ordinary development database gates', () => {
    expect(memoryMode.isLocalPlanningMemoryMode({ NODE_ENV: 'production', LOCAL_PLANNING_MEMORY_MODE: 'true' })).toBe(false);
    expect(memoryMode.isLocalPlanningMemoryMode({ NODE_ENV: 'development' })).toBe(false);
    expect(memoryMode.isLocalPlanningMemoryMode({
      NODE_ENV: 'development',
      LOCAL_PLANNING_MEMORY_MODE: 'true',
      DATABASE_URL: 'postgresql://configured',
    })).toBe(false);
  });

  it('skips bootstrap migrations only for the explicit local planning mode', () => {
    expect(shouldRunBootstrapMigrations).toBeTypeOf('function');
    expect(shouldRunBootstrapMigrations?.({
      NODE_ENV: 'development',
      LOCAL_PLANNING_MEMORY_MODE: 'true',
      DATABASE_URL: '',
    })).toBe(false);
    expect(shouldRunBootstrapMigrations?.({ NODE_ENV: 'development' })).toBe(true);
    expect(shouldRunBootstrapMigrations?.({
      NODE_ENV: 'production',
      LOCAL_PLANNING_MEMORY_MODE: 'true',
    })).toBe(true);
  });

  it('selects a restricted root module only for the explicit local planning mode', () => {
    expect(selectApiRootModule).toBeTypeOf('function');
    expect(selectApiRootModule?.({
      NODE_ENV: 'development',
      LOCAL_PLANNING_MEMORY_MODE: 'true',
      DATABASE_URL: '',
    }).name).toBe('LocalPlanningAppModule');
    expect(selectApiRootModule?.({ NODE_ENV: 'development' })).toBe(appComposition.AppModule);
  });
});

describe.sequential('local planning application composition', () => {
  let app: INestApplication | undefined;
  const environmentKeys = [
    'NODE_ENV',
    'LOCAL_PLANNING_MEMORY_MODE',
    'DATABASE_URL',
    'TRAVEL_AGENT_RUNTIME',
    'TRAVEL_AGENT_TEST_PROVIDER',
    'TRAVEL_LLM_API_KEY',
    'TRAVEL_LLM_MODEL',
    'AMAP_JS_KEY',
    'AMAP_JS_SECURITY_CODE',
    'AMAP_WEB_SERVICE_KEY',
  ] as const;
  const originalEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_PLANNING_MEMORY_MODE = 'true';
    process.env.DATABASE_URL = '';
    process.env.TRAVEL_AGENT_RUNTIME = 'legacy';
    delete process.env.TRAVEL_AGENT_TEST_PROVIDER;
    process.env.TRAVEL_LLM_API_KEY = 'local-planning-test-key';
    process.env.TRAVEL_LLM_MODEL = 'test-model';
    process.env.AMAP_JS_KEY = 'public-test-js-key';
    process.env.AMAP_JS_SECURITY_CODE = 'server-test-security-code';
    process.env.AMAP_WEB_SERVICE_KEY = 'server-test-web-key';

    const rootModule = selectApiRootModule?.(process.env) ?? appComposition.AppModule;
    const fakeFetch: typeof fetch = async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ text: string }> }> };
      const modelInput = JSON.parse(requestBody.input[1]!.content[0]!.text) as { tripId?: string; toolResults: Array<{ toolName: string }> };
      const structured = {
        assistantMessage: '本地 Conversation 规划检查完成。', planningContextPatch: null,
        reasoningSummary: '使用共享规划运行时，正式计划保持只读。', missingFields: [],
        toolCalls: [], actionRequests: [], planProposal: null,
      };
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(structured) }] }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const module = await Test.createTestingModule({ imports: [rootModule] })
      .overrideProvider(PLANNING_MODEL_FETCH)
      .useValue(fakeFetch)
      .compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    for (const key of environmentKeys) {
      const value = originalEnvironment.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('serves the non-booking planning surface without PostgreSQL', async () => {
    const server = app!.getHttpServer();
    await request(server).get('/health').expect(200).expect({ status: 'ok', service: 'api' });
    await request(server).get('/v1/map/public-config').expect(200).expect({
      jsKey: 'public-test-js-key',
      proxyUrl: '/_AMapService',
    });

    const ownerConversation = await request(server).post('/v1/conversations').send({}).expect(201);
    const cookie = ownerConversation.headers['set-cookie'][0].split(';')[0];
    const ownerId = cookie.split('=')[1];
    const created = await request(server)
      .post('/v1/trips')
      .set('x-actor-id', ownerId)
      .set('idempotency-key', 'local-planning-trip-1')
      .send({
        destination: '杭州',
        startsAt: '2026-10-01T00:00:00.000+08:00',
        endsAt: '2026-10-03T00:00:00.000+08:00',
        travelerCount: 2,
        totalBudgetCents: 300_000,
      })
      .expect(201);
    const tripId = created.body.id as string;

    await request(server).get(`/v1/trips/${tripId}`).set('x-actor-id', ownerId).expect(200);
    await request(server).get(`/v1/trips/${tripId}/itinerary`).set('x-actor-id', ownerId).expect(200).expect({ items: [], warnings: [] });
    const budget = await request(server).get(`/v1/trips/${tripId}/budget`).set('x-actor-id', ownerId).expect(200);
    expect(budget.body.totalLimit.amountCents).toBe(300_000);

    const search = await request(server)
      .post(`/v1/trips/${tripId}/searches`)
      .set('x-actor-id', ownerId)
      .send({ kinds: ['train'] })
      .expect(201);
    expect(search.body.offers.train.length).toBeGreaterThan(0);

    const plan = await request(server)
      .get(`/v1/trips/${tripId}/plans/current`)
      .set('x-actor-id', ownerId)
      .expect(200);
    expect(plan.body).toMatchObject({ version: 1, budget: { limit: { amountCents: 300_000 } } });
    const calculated = await request(server)
      .post(`/v1/trips/${tripId}/plans/commands`)
      .set('x-actor-id', ownerId)
      .send({ expectedVersion: 1, command: { kind: 'calculate' } })
      .expect(200);
    await request(server)
      .post(`/v1/trips/${tripId}/plans/undo`)
      .set('x-actor-id', ownerId)
      .send({ expectedVersion: calculated.body.version })
      .expect(200);

    await request(server).get(`/v1/trips/${tripId}/places`).set('x-actor-id', ownerId).expect(400);
    await request(server).post('/v1/agent/runs').send({}).expect(400);
    const conversation = await request(server).post('/v1/conversations').set('Cookie', cookie).send({ tripId }).expect(201);
    const turn = await request(server)
      .post(`/v1/conversations/${conversation.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '检查这个计划', clientMessageId: '018f47f2-3a8a-7c71-9d2d-f114dfe66a05' })
      .expect(201);
    expect(turn.body.agentRunId).toEqual(expect.any(String));
    const sharedPlan = await request(server).get(`/v1/trips/${tripId}/plans/current`).set('x-actor-id', ownerId).expect(200);
    expect(sharedPlan.body.version).toBe(3);
    await request(server).get('/v1/conversations/missing/events').expect(400);
  });

  it('does not register booking, order, payment, traveler, vault, audit, or webhook endpoints', async () => {
    const server = app!.getHttpServer();
    await request(server).get('/v1/trips/trip-1/orders').set('x-actor-id', 'local-planning-owner').expect(404);
    await request(server).post('/v1/trips/trip-1/booking-intents').set('x-actor-id', 'local-planning-owner').send({}).expect(404);
    await request(server).post('/v1/payments').send({}).expect(404);
    await request(server).post('/v1/travelers').send({}).expect(404);
    await request(server).post('/v1/traveler-data-grants').send({}).expect(404);
    await request(server).get('/v1/vault').expect(404);
    await request(server).get('/v1/trips/trip-1/audit').expect(404);
    await request(server).post('/v1/webhooks/suppliers/test').send({}).expect(404);
  });
});
