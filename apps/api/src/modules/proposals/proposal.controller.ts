import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApplicationError, PlanProposalService } from '@travel/application';
import { z } from 'zod';
import { AnonymousSessionGuard } from '../conversations/anonymous-session.js';

const acceptPlaceSchema = z.object({ expectedProposalVersion: z.number().int().positive() }).strict();
const acceptSchema = z.object({
  expectedProposalVersion: z.number().int().positive(),
  expectedPlanningContextVersion: z.number().int().positive(),
  expectedPlanVersion: z.number().int().positive(),
}).strict();
const rejectSchema = z.object({ expectedProposalVersion: z.number().int().positive() }).strict();

interface SessionRequest { anonymousSessionId?: string }

@Controller('v1/conversations/:conversationId/plan-proposals')
@UseGuards(AnonymousSessionGuard)
export class ProposalController {
  constructor(@Inject(PlanProposalService) private readonly proposals: PlanProposalService) {}

  @Get('current')
  async current(@Req() request: SessionRequest, @Param('conversationId') conversationId: string) {
    return (await this.proposals.current(this.session(request), conversationId)) ?? { proposal: null };
  }

  @Post(':proposalId/places/:placeId/accept')
  async acceptPlace(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Param('proposalId') proposalId: string, @Param('placeId') placeId: string, @Body() rawBody: unknown) {
    const parsed = acceptPlaceSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid proposal place acceptance');
    return this.proposals.acceptPlace(this.session(request), conversationId, proposalId, { ...parsed.data, placeId });
  }

  @Post(':proposalId/accept')
  @HttpCode(200)
  async accept(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Param('proposalId') proposalId: string, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() rawBody: unknown) {
    if (!idempotencyKey?.trim()) throw new ApplicationError('validation_error', 'idempotency-key header is required');
    const parsed = acceptSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid proposal acceptance');
    return this.proposals.accept(this.session(request), conversationId, proposalId, { ...parsed.data, idempotencyKey: idempotencyKey.trim() });
  }

  @Post(':proposalId/reject')
  @HttpCode(200)
  async reject(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Param('proposalId') proposalId: string, @Body() rawBody: unknown) {
    const parsed = rejectSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid proposal rejection');
    return this.proposals.reject(this.session(request), conversationId, proposalId, parsed.data.expectedProposalVersion);
  }

  private session(request: SessionRequest): string {
    if (!request.anonymousSessionId) throw new ApplicationError('unauthorized');
    return request.anonymousSessionId;
  }
}
