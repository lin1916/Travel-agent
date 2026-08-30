import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApplicationError } from '@travel/application';
import { PlanningOrchestrator } from '@travel/agent-runtime';
import { z } from 'zod';
import { AGENT_ORCHESTRATOR } from './agent.tokens.js';

const StartSchema = z.object({
  tripId: z.string().min(1),
  userMessage: z.string().min(1),
  risk: z.enum(['read', 'prepare', 'commit', 'redirect']).optional(),
}).strict();
const ResumeSchema = z.object({ userMessage: z.string().min(1), risk: z.enum(['read', 'prepare', 'commit', 'redirect']).optional() }).strict();

@Controller('v1/agent/runs')
export class AgentController {
  constructor(@Inject(AGENT_ORCHESTRATOR) private readonly orchestrator: PlanningOrchestrator) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(@Headers('x-actor-id') actorId: string | undefined, @Body() rawBody: unknown) {
    const parsed = StartSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid planning request');
    if ((parsed.data.risk === 'commit' || parsed.data.risk === 'redirect') && !actorId) {
      throw new ApplicationError('policy_blocked', 'authenticated actor is required for commit capabilities');
    }
    try {
      return await this.orchestrator.start({ tripId: parsed.data.tripId, userMessage: parsed.data.userMessage, actorId, requestedRisk: parsed.data.risk });
    } catch (error) {
      if (error instanceof Error && error.message.includes('another actor')) throw new ApplicationError('forbidden', error.message);
      if (error instanceof Error && error.message === 'trip not found') throw new ApplicationError('validation_error', error.message);
      throw error;
    }
  }

  @Get(':runId')
  async get(@Headers('x-actor-id') actorId: string | undefined, @Param('runId') runId: string) {
    try {
      const run = await this.orchestrator.get(runId, actorId);
      if (!run) throw new ApplicationError('validation_error', 'agent run not found');
      return run;
    } catch (error) {
      if (error instanceof Error && error.message.includes('another actor')) throw new ApplicationError('forbidden', error.message);
      throw error;
    }
  }

  @Post(':runId/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@Headers('x-actor-id') actorId: string | undefined, @Param('runId') runId: string, @Body() rawBody: unknown) {
    const parsed = ResumeSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid resume request');
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
