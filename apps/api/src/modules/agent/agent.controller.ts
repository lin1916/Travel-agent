import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApplicationError, ConversationService } from '@travel/application';
import { PlanningOrchestrator } from '@travel/agent-runtime';
import { z } from 'zod';
import { AGENT_ORCHESTRATOR } from './agent.tokens.js';
import { ensureCorrelationContext } from '@travel/observability';
import { AnonymousSessionGuard } from '../conversations/anonymous-session.js';

const StartSchema = z.object({
  conversationId: z.string().min(1).optional(),
  tripId: z.string().min(1).optional(),
  userMessage: z.string().min(1),
  risk: z.enum(['read', 'prepare', 'commit', 'redirect']).optional(),
}).strict().refine(value => value.conversationId || value.tripId, 'conversationId or tripId is required');
const ResumeSchema = z.object({ userMessage: z.string().min(1), risk: z.enum(['read', 'prepare', 'commit', 'redirect']).optional() }).strict();

@Controller('v1/agent/runs')
@UseGuards(AnonymousSessionGuard)
export class AgentController {
  constructor(
    @Inject(AGENT_ORCHESTRATOR) private readonly orchestrator: PlanningOrchestrator,
    @Inject(ConversationService) private readonly conversations: ConversationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(@Req() request: any, @Body() rawBody: unknown) {
    const parsed = StartSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid planning request');
    const actorId = request.anonymousSessionId as string | undefined;
    if ((parsed.data.risk === 'commit' || parsed.data.risk === 'redirect') && !actorId) {
      throw new ApplicationError('policy_blocked', 'authenticated actor is required for commit capabilities');
    }
    try {
      const context = ensureCorrelationContext(request);
      const conversation = parsed.data.conversationId && actorId
        ? await this.conversations.get(actorId, parsed.data.conversationId)
        : undefined;
      if (conversation?.tripId && parsed.data.tripId && conversation.tripId !== parsed.data.tripId) {
        throw new ApplicationError('conflict', 'trip does not match the conversation');
      }
      return await this.orchestrator.start({
        conversationId: conversation?.id,
        tripId: parsed.data.tripId ?? conversation?.tripId,
        userMessage: parsed.data.userMessage,
        planningContext: conversation?.planningContext,
        actorId,
        requestedRisk: parsed.data.risk,
        requestId: context.requestId,
        correlationId: context.correlationId,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('another actor')) throw new ApplicationError('forbidden', error.message);
      if (error instanceof Error && error.message === 'trip not found') throw new ApplicationError('validation_error', error.message);
      throw error;
    }
  }

  @Get(':runId')
  async get(@Req() request: any, @Param('runId') runId: string) {
    try {
      const run = await this.orchestrator.get(runId, request.anonymousSessionId);
      if (!run) throw new ApplicationError('validation_error', 'agent run not found');
      return run;
    } catch (error) {
      if (error instanceof Error && error.message.includes('another actor')) throw new ApplicationError('forbidden', error.message);
      throw error;
    }
  }

  @Post(':runId/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@Req() request: any, @Param('runId') runId: string, @Body() rawBody: unknown) {
    const parsed = ResumeSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid resume request');
    const actorId = request.anonymousSessionId as string | undefined;
    if ((parsed.data.risk === 'commit' || parsed.data.risk === 'redirect') && !actorId) {
      throw new ApplicationError('policy_blocked', 'authenticated actor is required for commit capabilities');
    }
    try {
      return await this.orchestrator.resume(runId, parsed.data.userMessage, actorId, parsed.data.risk);
    } catch (error) {
      if (error instanceof Error && error.message === 'agent run not found') throw new ApplicationError('validation_error', error.message);
      if (error instanceof Error && error.message.includes('another actor')) throw new ApplicationError('forbidden', error.message);
      if (error instanceof Error && error.message.includes('trip version changed')) throw new ApplicationError('conflict', error.message);
      throw error;
    }
  }
}
