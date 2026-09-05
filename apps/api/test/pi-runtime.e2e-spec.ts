import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { CapabilityGateway } from '@travel/capability-gateway';
import { ConversationService, InMemoryConversationRepository, type ConversationTurnRunner } from '@travel/application';
import { createPiTravelTools } from '@travel/agent-runtime';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApplicationErrorFilter } from '../src/app-error.filter.js';
import { CONVERSATION_MODEL, ConversationController } from '../src/modules/conversations/conversation.controller.js';
import { AnonymousSessionGuard, AnonymousSessionProvider } from '../src/modules/conversations/anonymous-session.js';
import { InMemoryConversationEventStore } from '../src/modules/conversations/conversation-event-store.js';

describe('Pi runtime conversation SSE', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const events = new InMemoryConversationEventStore({ now: () => new Date('2026-09-03T00:00:00.000Z'), id: () => crypto.randomUUID() });
    const runner: ConversationTurnRunner = {
      run: async input => {
        await input.onEvent?.({ type: 'ModelStarted', runId: 'pi-run-1', correlationId: 'pi-correlation-1', payload: { round: 1 } });
        await input.onEvent?.({ type: 'ModelCompleted', runId: 'pi-run-1', correlationId: 'pi-correlation-1', payload: { round: 1, toolCallCount: 0 } });
        return { assistantMessage: 'Plan ready', agentRunId: 'pi-run-1', correlationId: 'pi-correlation-1' };
      },
    };
    const sessions = new AnonymousSessionProvider();
    const service = new ConversationService(new InMemoryConversationRepository(), runner, undefined, undefined, events);
    const module = await Test.createTestingModule({
      controllers: [ConversationController],
      providers: [
        { provide: AnonymousSessionGuard, useFactory: () => new AnonymousSessionGuard(sessions, service) },
        { provide: AnonymousSessionProvider, useValue: sessions },
        { provide: ConversationService, useValue: service },
        { provide: InMemoryConversationEventStore, useValue: events },
        { provide: CONVERSATION_MODEL, useValue: { providerName: 'pi', model: 'gpt-5.5' } },
      ],
    }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.useGlobalFilters(new ApplicationErrorFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app.close());

  it('blocks booking and payment tool names while preserving the SSE event shape', async () => {
    expect(createPiTravelTools(new CapabilityGateway()).map(tool => tool.name)).not.toContain('booking');
    expect(createPiTravelTools(new CapabilityGateway()).map(tool => tool.name)).not.toContain('payment');

    const created = await request(app.getHttpServer()).post('/v1/conversations').send({});
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const appended = await request(app.getHttpServer()).post(`/v1/conversations/${created.body.id}/messages`).set('Cookie', cookie).send({ content: 'Plan Hangzhou' });
    const response = await fetch(`${baseUrl}/v1/conversations/${created.body.id}/events`, { headers: { cookie, accept: 'text/event-stream' } });
    const reader = response.body!.getReader();
    let body = '';
    while (!body.includes('ModelCompleted')) body += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();

    expect(response.status).toBe(200);
    expect(body).toContain('ModelStarted');
    expect(body).toContain('ModelCompleted');
    expect(body).toContain('"schema_version":1');
    expect(body).toContain('"run_id":"pi-run-1"');
    expect(body).toContain('"correlation_id":"pi-correlation-1"');
    expect(appended.body.agentRunId).toBe('pi-run-1');
  });
});
