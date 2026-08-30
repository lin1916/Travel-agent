import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApplicationError } from '@travel/application';
import { PlanningOrchestrator } from '@travel/agent-runtime';
import { z } from 'zod';
import { AGENT_ORCHESTRATOR } from './agent.tokens.js';

const StartSchema = z.object({
  tripId: z.string().min(1),
  userMessage: z.string().min(1),
  risk: z.enum(['read', 'prepare', 'commit', 'redirect']).optional(),
  currentTripVersion: z.number().int().positive().optional(),
}).strict();
const ResumeSchema = z.object({ userMessage: z.string().min(1), currentTripVersion: z.number().int().positive().optional() }).strict();

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
    return this.orchestrator.start({ tripId: parsed.data.tripId, userMessage: parsed.data.userMessage, actorId, currentTripVersion: parsed.data.currentTripVersion });
  }

  @Get(':runId')
  async get(@Param('runId') runId: string) {
    const run = this.orchestrator.get(runId);
    if (!run) throw new ApplicationError('validation_error', 'agent run not found');
    return run;
  }

  @Post(':runId/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@Param('runId') runId: string, @Body() rawBody: unknown) {
    const parsed = ResumeSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid resume request');
    try {
      return await this.orchestrator.resume(runId, parsed.data.userMessage, parsed.data.currentTripVersion);
    } catch (error) {
      if (error instanceof Error && error.message === 'agent run not found') throw new ApplicationError('validation_error', error.message);
      throw error;
    }
  }
}
