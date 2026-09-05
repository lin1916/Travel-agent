import { Body, Controller, Delete, Get, Headers, Inject, MessageEvent, Param, Post, Req, Sse, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConversationService, ApplicationError } from '@travel/application';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { AnonymousSessionGuard } from './anonymous-session.js';
import { InMemoryConversationEventStore } from './conversation-event-store.js';

export const CONVERSATION_MODEL = Symbol('CONVERSATION_MODEL');
const createSchema = z.object({ tripId: z.string().min(1).optional() }).strict();
const messageSchema = z.object({ content: z.string().trim().min(1).max(20_000), clientMessageId: z.string().uuid().optional() }).strict();

interface SessionRequest { anonymousSessionId?: string }

@Controller('v1/conversations')
@UseGuards(AnonymousSessionGuard)
export class ConversationController {
  constructor(
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(CONVERSATION_MODEL) private readonly model: { providerName: string; model: string },
    @Inject(InMemoryConversationEventStore) private readonly eventStore: InMemoryConversationEventStore,
  ) {}

  @Post()
  create(@Req() request: SessionRequest, @Body() rawBody: unknown) {
    const body = createSchema.safeParse(rawBody ?? {});
    if (!body.success) throw new ApplicationError('validation_error', body.error.issues[0]?.message);
    return this.conversations.create(this.session(request), { ...this.model, ...body.data });
  }

  @Get(':id')
  get(@Req() request: SessionRequest, @Param('id') id: string) {
    return this.conversations.get(this.session(request), id);
  }

  @Post(':id/messages')
  append(@Req() request: SessionRequest, @Param('id') id: string, @Body() rawBody: unknown) {
    const body = messageSchema.safeParse(rawBody);
    if (!body.success) throw new ApplicationError('validation_error', body.error.issues[0]?.message);
    return this.conversations.appendUserMessage(this.session(request), id, {
      ...body.data,
      clientMessageId: body.data.clientMessageId ?? randomUUID(),
    });
  }

  @Sse(':id/events')
  async events(@Req() request: SessionRequest, @Param('id') id: string, @Headers('last-event-id') lastEventId?: string): Promise<Observable<MessageEvent>> {
    await this.conversations.get(this.session(request), id);
    const iterator = this.eventStore.subscribe(id, lastEventId)[Symbol.asyncIterator]();
    return new Observable<MessageEvent>(subscriber => {
      let active = true;
      void (async () => {
        try {
          while (active) {
            const next = await iterator.next();
            if (next.done) break;
            subscriber.next({ id: next.value.event_id, type: next.value.event_type, data: next.value });
          }
          if (active) subscriber.complete();
        } catch (error) {
          if (active) subscriber.error(error);
        }
      })();
      return () => { active = false; void iterator.return?.(); };
    });
  }

  @Delete(':id')
  async delete(@Req() request: SessionRequest, @Param('id') id: string) {
    await this.conversations.delete(this.session(request), id);
    return { deleted: true };
  }

  private session(request: SessionRequest): string {
    if (!request.anonymousSessionId) throw new ApplicationError('unauthorized');
    return request.anonymousSessionId;
  }
}
