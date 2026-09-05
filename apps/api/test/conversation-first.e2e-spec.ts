import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import { LocalPlanningAppModule } from '../src/local-planning-app.module.js';
import { PLANNING_MODEL_FETCH } from '../src/modules/agent/agent.tokens.js';

const firstMessageId = '018f47f2-3a8a-7c71-9d2d-f114dfe66a01';
const secondMessageId = '018f47f2-3a8a-7c71-9d2d-f114dfe66a02';
const replayMessageId = '018f47f2-3a8a-7c71-9d2d-f114dfe66a03';
const concurrentMessageId = '018f47f2-3a8a-7c71-9d2d-f114dfe66a04';

function modelResponse(output: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    assistantMessage: '已收到并处理本轮规划信息。',
    planningContextPatch: null,
    reasoningSummary: '根据当前对话上下文继续规划。',
    missingFields: [],
    toolCalls: [],
    actionRequests: [],
    planProposal: null,
    ...overrides,
  };
}

function modelInput(init?: RequestInit) {
  const body = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ text: string }> }> };
  return JSON.parse(body.input[1]!.content[0]!.text) as {
    conversationId?: string;
    tripId?: string;
    agentRunId: string;
    userMessage: string;
    planningContext: { version: number; missingFields: string[] };
    priorMessages: Array<{ role: string; content: string }>;
    toolResults: Array<{ toolName: string }>;
  };
}

describe.sequential('conversation-first shared planning runtime', () => {
  let app: INestApplication;
  const requests: ReturnType<typeof modelInput>[] = [];
  let releaseConcurrent!: () => void;
  let concurrentStarted!: () => void;
  let concurrentStart = new Promise<void>(resolve => { concurrentStarted = resolve; });
  const concurrentBlock = new Promise<void>(resolve => { releaseConcurrent = resolve; });
  let releaseReplayConflict!: () => void;
  let replayConflictStarted!: () => void;
  const replayConflictStart = new Promise<void>(resolve => { replayConflictStarted = resolve; });
  const replayConflictBlock = new Promise<void>(resolve => { releaseReplayConflict = resolve; });
  const environmentKeys = ['NODE_ENV', 'LOCAL_PLANNING_MEMORY_MODE', 'DATABASE_URL', 'TRAVEL_AGENT_RUNTIME', 'TRAVEL_LLM_API_KEY', 'TRAVEL_LLM_MODEL'] as const;
  const originalEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_PLANNING_MEMORY_MODE = 'true';
    process.env.DATABASE_URL = '';
    process.env.TRAVEL_AGENT_RUNTIME = 'legacy';
    process.env.TRAVEL_LLM_API_KEY = 'fake-transport-key';
    process.env.TRAVEL_LLM_MODEL = 'test-model';
    const fetcher: typeof fetch = async (_input, init) => {
      const input = modelInput(init);
      requests.push(input);
      if (input.userMessage === '并发一') {
        concurrentStarted();
        await concurrentBlock;
        return modelResponse(output({ assistantMessage: '并发一已完成。' }));
      }
      if (input.userMessage === '同号原始内容') {
        replayConflictStarted();
        await replayConflictBlock;
        return modelResponse(output({ assistantMessage: '同号原始内容已完成。' }));
      }
      if (input.userMessage === '我想 10 月 1 日到 4 日去杭州') {
        if (input.toolResults.length === 0) {
          const patch = { destination: '杭州', startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00' };
          return modelResponse(output({
            assistantMessage: '我先记录杭州和日期。',
            planningContextPatch: patch,
            missingFields: ['travelerCount'],
            toolCalls: [{ toolName: 'update_planning_context', input: { expectedContextVersion: 1, patch } }],
          }));
        }
        return modelResponse(output({ assistantMessage: '杭州和日期已记录，请继续告诉我人数和预算。', missingFields: ['travelerCount'] }));
      }
      if (input.userMessage === '两个人，预算 5000 元，喜欢人文景点和本地餐馆') {
        if (input.planningContext.version === 2) {
          const patch = { travelerCount: 2, totalBudgetCents: 500_000, preferences: ['人文景点', '本地餐馆'] };
          return modelResponse(output({
            assistantMessage: '信息完整，正在创建行程。',
            planningContextPatch: patch,
            toolCalls: [{ toolName: 'update_planning_context', input: { expectedContextVersion: 2, patch } }],
          }));
        }
        if (input.toolResults.some(result => result.toolName === 'update_planning_context')) {
          return modelResponse(output({
            assistantMessage: '正在读取用户已保存的地点。',
            toolCalls: [{ toolName: 'list_candidate_places', input: {} }],
          }));
        }
        return modelResponse(output({ assistantMessage: '杭州双人行程草案已经准备好。' }));
      }
      return modelResponse(output({ assistantMessage: `模型回复：${input.userMessage}` }));
    };
    const module = await Test.createTestingModule({ imports: [LocalPlanningAppModule] })
      .overrideProvider(PLANNING_MODEL_FETCH)
      .useValue(fetcher)
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

  it('runs every distinct message through one shared runtime and cookie-owned Trip', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const sessionId = cookie.split('=')[1];
    const before = requests.length;
    const first = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '我想 10 月 1 日到 4 日去杭州', clientMessageId: firstMessageId })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '两个人，预算 5000 元，喜欢人文景点和本地餐馆', clientMessageId: secondMessageId })
      .expect(201);

    expect(requests.length - before).toBeGreaterThanOrEqual(2);
    expect(first.body.messages.at(-1).content).not.toContain('已记下你的想法');
    expect(second.body.messages.at(-1).content).not.toContain('已记下你的想法');
    expect(second.body.agentRunId).not.toBe(first.body.agentRunId);
    expect(second.body).toMatchObject({ id: created.body.id, tripId: expect.any(String), planningContext: { conversationId: created.body.id, version: 3, missingFields: [] } });
    expect(requests.at(-1)?.conversationId).toBe(created.body.id);
    expect(requests.at(-1)?.priorMessages.map(message => message.content)).toContain(first.body.messages.at(-1).content);

    const run = await request(app.getHttpServer()).get(`/v1/agent/runs/${second.body.agentRunId}`).set('Cookie', cookie).expect(200);
    expect(run.body).toMatchObject({ runId: second.body.agentRunId, conversationId: created.body.id, tripId: second.body.tripId, actorId: sessionId });
    await request(app.getHttpServer()).get(`/v1/trips/${second.body.tripId}`).set('x-actor-id', sessionId).expect(200);
    const plan = await request(app.getHttpServer()).get(`/v1/trips/${second.body.tripId}/plans/current`).set('x-actor-id', sessionId).expect(200);
    expect(plan.body.version).toBe(1);
    expect(plan.body.items).toEqual([]);
    const conversationPlan = await request(app.getHttpServer()).get(`/v1/conversations/${created.body.id}/plan`).set('Cookie', cookie).expect(200);
    expect(conversationPlan.body).toEqual({ plan: null, currentVersion: plan.body.version });
    expect(JSON.stringify(run.body.toolCallSummaries)).not.toMatch(/forbidden|policy_blocked/);
  });

  it('replays matching message IDs, rejects changed or invalid IDs, and does not call the provider again', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const first = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '重放测试', clientMessageId: replayMessageId })
      .expect(201);
    const requestCount = requests.length;
    const replay = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '重放测试', clientMessageId: replayMessageId })
      .expect(201);

    expect(replay.body).toEqual(first.body);
    expect(requests).toHaveLength(requestCount);
    await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '不同内容', clientMessageId: replayMessageId })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '无效 ID', clientMessageId: 'not-a-uuid' })
      .expect(400);
    expect(requests).toHaveLength(requestCount);
  });

  it('rejects overlapping distinct turns instead of starting concurrent model runs', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const first = request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '并发一', clientMessageId: concurrentMessageId });
    void first.then(() => undefined);
    await concurrentStart;

    const second = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '并发二', clientMessageId: secondMessageId })
      .expect(409);
    expect(second.body).toMatchObject({ code: 'conflict' });
    releaseConcurrent();
    await first.expect(201);
  });

  it('rejects changed content for an in-flight message ID without another provider request', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const before = requests.length;

    const first = request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '同号原始内容', clientMessageId: replayMessageId });
    void first.then(() => undefined);
    await replayConflictStart;
    const conflict = await request(app.getHttpServer())
      .post(`/v1/conversations/${created.body.id}/messages`)
      .set('Cookie', cookie)
      .send({ content: '不同内容', clientMessageId: replayMessageId })
      .expect(409);
    expect(conflict.body).toMatchObject({ code: 'conflict' });
    expect(requests.length - before).toBe(1);
    releaseReplayConflict();
    await first.expect(201);
  });

  it('uses the anonymous cookie, not x-actor-id, for direct Agent run ownership', async () => {
    const conversation = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const cookie = conversation.headers['set-cookie'][0].split(';')[0];
    const sessionId = cookie.split('=')[1];
    const trip = await request(app.getHttpServer()).post('/v1/trips')
      .set('x-actor-id', sessionId)
      .set('idempotency-key', 'direct-agent-trip')
      .send({ destination: '杭州', startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00', travelerCount: 2, totalBudgetCents: 500_000 })
      .expect(201);
    const started = await request(app.getHttpServer()).post('/v1/agent/runs')
      .set('Cookie', cookie)
      .set('x-actor-id', 'attacker')
      .send({ tripId: trip.body.id, userMessage: 'direct start', risk: 'prepare' })
      .expect(201);
    expect(started.body.actorId).toBe(sessionId);
    await request(app.getHttpServer()).get(`/v1/agent/runs/${started.body.runId}`).set('Cookie', cookie).set('x-actor-id', 'attacker').expect(200);

    const other = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const otherCookie = other.headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).get(`/v1/agent/runs/${started.body.runId}`).set('Cookie', otherCookie).set('x-actor-id', sessionId).expect(403);
  });

  it('starts a direct Agent run from cookie-owned Conversation scope', async () => {
    const conversation = await request(app.getHttpServer()).post('/v1/conversations').send({}).expect(201);
    const cookie = conversation.headers['set-cookie'][0].split(';')[0];

    const started = await request(app.getHttpServer()).post('/v1/agent/runs')
      .set('Cookie', cookie)
      .send({ conversationId: conversation.body.id, userMessage: 'continue this conversation', risk: 'prepare' })
      .expect(201);

    expect(started.body).toMatchObject({ conversationId: conversation.body.id });
    expect(started.body).not.toHaveProperty('tripId');
  });
});
