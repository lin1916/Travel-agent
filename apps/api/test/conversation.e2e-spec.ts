import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationService, InMemoryConversationRepository, type ConversationTurnRunner } from '@travel/application';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import { ConversationController, CONVERSATION_MODEL } from '../src/modules/conversations/conversation.controller.js';
import { AnonymousSessionCleanupPort, AnonymousSessionGuard, AnonymousSessionProvider } from '../src/modules/conversations/anonymous-session.js';
import { InMemoryConversationEventStore } from '../src/modules/conversations/conversation-event-store.js';

describe('conversation API', () => {
  const clientMessageId = (suffix: number) => `018f47f2-3a8a-7c71-9d2d-f114dfe66a${suffix.toString().padStart(2, '0')}`;
  let app: INestApplication;
  let now = new Date('2026-09-03T00:00:00.000Z');
  let nextId = 0;
  let events: InMemoryConversationEventStore;
  let deletedRuns: string[];
  let baseUrl: string;
  let repository: InMemoryConversationRepository;

  beforeAll(async () => {
    repository = new InMemoryConversationRepository();
    deletedRuns = [];
    events = new InMemoryConversationEventStore({ now: () => now, id: () => `event-${++nextId}` });
    const runner: ConversationTurnRunner = { run: async input => {
      await input.onEvent?.({ type: 'AgentTurnStarted', runId: `run-${nextId + 1}`, correlationId: `corr-${nextId + 1}`, payload: { turnId: `run-${nextId + 1}` } });
      await input.onEvent?.({ type: 'ToolCallStarted', runId: `run-${nextId + 1}`, correlationId: `corr-${nextId + 1}`, payload: { toolName: 'search_offers' } });
      await input.onEvent?.({ type: 'ToolCallCompleted', runId: `run-${nextId + 1}`, correlationId: `corr-${nextId + 1}`, payload: { toolName: 'search_offers' } });
      return { assistantMessage: `Reply to ${input.messages.at(-1)?.content}`, agentRunId: `run-${++nextId}`, correlationId: `corr-${nextId}` };
    } };
    const service = new ConversationService(repository, runner, { now: () => now, id: () => `id-${++nextId}` }, { deleteConversation: async conversationId => { deletedRuns.push(conversationId); return 1; } }, events);
    const sessions = new AnonymousSessionProvider({ now: () => now, id: () => `session-${++nextId}` });
    const module = await Test.createTestingModule({
      controllers: [ConversationController],
      providers: [
        { provide: AnonymousSessionGuard, useFactory: () => new AnonymousSessionGuard(sessions, { purgeExpired: () => service.purgeExpired() } as AnonymousSessionCleanupPort) },
        { provide: AnonymousSessionProvider, useValue: sessions },
        { provide: AnonymousSessionCleanupPort, useValue: { purgeExpired: () => service.purgeExpired() } },
        { provide: ConversationService, useValue: service },
        { provide: InMemoryConversationEventStore, useValue: events },
        { provide: CONVERSATION_MODEL, useValue: { providerName: 'explicit-test-provider', model: 'test-model' } },
      ],
    }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app?.close());

  it('creates, appends, recovers, and immediately deletes a cookie-owned conversation', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({});
    expect(created.status).toBe(201);
    expect(created.headers['set-cookie']?.[0]).toMatch(/travel_session=.*HttpOnly.*SameSite=Lax/i);
    const cookie = created.headers['set-cookie'][0].split(';')[0];

    const appended = await request(app.getHttpServer()).post(`/v1/conversations/${created.body.id}/messages`).set('Cookie', cookie).send({ content: 'Plan Hangzhou', clientMessageId: clientMessageId(1) });
    expect(appended.status).toBe(201);
    expect(appended.body.messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant']);

    const recovered = await request(app.getHttpServer()).get(`/v1/conversations/${created.body.id}`).set('Cookie', cookie);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ providerName: 'explicit-test-provider', model: 'test-model', agentRunId: expect.stringMatching(/^run-/) });

    const abort = new AbortController();
    const stream = await fetch(`${baseUrl}/v1/conversations/${created.body.id}/events`, { headers: { cookie, accept: 'text/event-stream', 'last-event-id': appended.body.messages[0].id }, signal: abort.signal });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    let body = '';
    while (!body.includes(appended.body.messages[1].id)) body += new TextDecoder().decode((await reader.read()).value);
    expect(body).not.toContain(appended.body.messages[0].id);
    expect(body).toContain('AgentTurnStarted');
    expect(body).toContain('ToolCallCompleted');
    expect(body).toContain('"schema_version":1');
    expect(body).toContain('"correlation_id":"corr-');

    const liveAppend = await request(app.getHttpServer()).post(`/v1/conversations/${created.body.id}/messages`).set('Cookie', cookie).send({ content: 'Make day two relaxed', clientMessageId: clientMessageId(2) });
    while (!body.includes(liveAppend.body.messages.at(-1).id)) body += new TextDecoder().decode((await reader.read()).value);
    abort.abort();
    expect(body).toContain(liveAppend.body.messages.at(-1).id);

    expect((await request(app.getHttpServer()).delete(`/v1/conversations/${created.body.id}`).set('Cookie', cookie)).status).toBe(200);
    expect((await request(app.getHttpServer()).get(`/v1/conversations/${created.body.id}`).set('Cookie', cookie)).status).toBe(400);
    expect(deletedRuns).toContain(created.body.id);
    let deletedEventError: unknown;
    try { events.subscribe(created.body.id, liveAppend.body.messages.at(-1).id); } catch (error) { deletedEventError = error; }
    expect(deletedEventError).toMatchObject({ code: 'validation_error' });
  });

  it('rejects malformed input and cross-session access without trusting x-actor-id', async () => {
    const first = await request(app.getHttpServer()).post('/v1/conversations').set('x-actor-id', 'same-browser-value').send({});
    const firstCookie = first.headers['set-cookie'][0].split(';')[0];
    const second = await request(app.getHttpServer()).post('/v1/conversations').set('x-actor-id', 'same-browser-value').send({});
    const secondCookie = second.headers['set-cookie'][0].split(';')[0];

    expect((await request(app.getHttpServer()).post(`/v1/conversations/${first.body.id}/messages`).set('Cookie', firstCookie).send({ content: '' })).status).toBe(400);
    expect((await request(app.getHttpServer()).get(`/v1/conversations/${first.body.id}`).set('Cookie', secondCookie)).status).toBe(403);
  });

  it('rejects an expired anonymous session', async () => {
    const created = await request(app.getHttpServer()).post('/v1/conversations').send({});
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const appended = await request(app.getHttpServer()).post(`/v1/conversations/${created.body.id}/messages`).set('Cookie', cookie).send({ content: 'Plan Hangzhou', clientMessageId: clientMessageId(3) });
    now = new Date('2026-09-10T00:00:00.001Z');

    const expired = await request(app.getHttpServer()).get(`/v1/conversations/${created.body.id}`).set('Cookie', cookie);

    expect(expired.status).toBe(401);
    expect(deletedRuns).toContain(created.body.id);
    let expiredEventError: unknown;
    try { events.subscribe(created.body.id, appended.body.messages[0].id); } catch (error) { expiredEventError = error; }
    expect(expiredEventError).toMatchObject({ code: 'validation_error' });
  });

  it('rejects unknown and cross-conversation Last-Event-ID values', async () => {
    now = new Date('2026-09-03T00:00:00.000Z');
    const first = await request(app.getHttpServer()).post('/v1/conversations').send({});
    const firstCookie = first.headers['set-cookie'][0].split(';')[0];
    const firstAppend = await request(app.getHttpServer()).post(`/v1/conversations/${first.body.id}/messages`).set('Cookie', firstCookie).send({ content: 'first', clientMessageId: clientMessageId(4) });
    const second = await request(app.getHttpServer()).post('/v1/conversations').send({});
    const secondCookie = second.headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).post(`/v1/conversations/${second.body.id}/messages`).set('Cookie', secondCookie).send({ content: 'second', clientMessageId: clientMessageId(5) });

    expect((await request(app.getHttpServer()).get(`/v1/conversations/${first.body.id}/events`).set('Cookie', firstCookie).set('Last-Event-ID', 'unknown-event')).status).toBe(400);
    expect((await request(app.getHttpServer()).get(`/v1/conversations/${second.body.id}/events`).set('Cookie', secondCookie).set('Last-Event-ID', firstAppend.body.messages[0].id)).status).toBe(400);
  });

  it('rejects an expired cookie for protected actions and sweeps only conversations past their own TTL', async () => {
    now = new Date('2026-09-03T00:00:00.000Z');
    const early = await request(app.getHttpServer()).post('/v1/conversations').send({});
    const expiredCookie = early.headers['set-cookie'][0].split(';')[0];
    const earlyTurn = await request(app.getHttpServer()).post(`/v1/conversations/${early.body.id}/messages`).set('Cookie', expiredCookie).send({ content: 'early', clientMessageId: clientMessageId(6) });
    now = new Date('2026-09-09T00:00:00.000Z');
    const later = await request(app.getHttpServer()).post('/v1/conversations').set('Cookie', expiredCookie).send({});
    expect(later.headers['set-cookie']).toBeUndefined();
    const laterTurn = await request(app.getHttpServer()).post(`/v1/conversations/${later.body.id}/messages`).set('Cookie', expiredCookie).send({ content: 'later', clientMessageId: clientMessageId(7) });
    expect(laterTurn.status).toBe(201);
    const laterMessageCount = laterTurn.body.messages.length;
    now = new Date('2026-09-11T00:00:00.000Z');

    const unrelated = await request(app.getHttpServer()).post('/v1/conversations').send({});

    expect(unrelated.status).toBe(201);
    expect(await repository.get(early.body.id)).toBeUndefined();
    expect(await repository.get(later.body.id)).toMatchObject({ id: later.body.id, expiresAt: '2026-09-16T00:00:00.000Z' });
    expect(deletedRuns).toContain(early.body.id);
    expect(deletedRuns).not.toContain(later.body.id);
    let earlyEventError: unknown;
    try { events.subscribe(early.body.id, earlyTurn.body.messages[0].id); } catch (error) { earlyEventError = error; }
    expect(earlyEventError).toMatchObject({ code: 'validation_error' });

    expect((await request(app.getHttpServer()).post(`/v1/conversations/${later.body.id}/messages`).set('Cookie', expiredCookie).send({ content: 'must not append' })).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`/v1/conversations/${later.body.id}`).set('Cookie', expiredCookie)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`/v1/conversations/${later.body.id}/events`).set('Cookie', expiredCookie)).status).toBe(401);
    expect((await request(app.getHttpServer()).delete(`/v1/conversations/${later.body.id}`).set('Cookie', expiredCookie)).status).toBe(401);
    expect((await repository.get(later.body.id))?.messages).toHaveLength(laterMessageCount);

    const rotated = await request(app.getHttpServer()).post('/v1/conversations').set('Cookie', expiredCookie).send({});
    expect(rotated.status).toBe(201);
    expect(rotated.headers['set-cookie'][0].split(';')[0]).not.toBe(expiredCookie);
  });
});
