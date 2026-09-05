import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApplicationError, CandidateService } from '@travel/application';
import { PlaceSchema } from '@travel/contracts';
import { z } from 'zod';
import { AnonymousSessionGuard } from '../conversations/anonymous-session.js';

const createCandidateSchema = z.object({
  place: PlaceSchema,
  source: z.literal('user_search').optional(),
  note: z.string().trim().min(1).max(2_000).optional(),
  priority: z.number().int().nonnegative().optional(),
}).strict();
const patchCandidateSchema = z.object({
  note: z.string().trim().min(1).max(2_000).optional(),
  priority: z.number().int().nonnegative().optional(),
}).strict().refine(value => value.note !== undefined || value.priority !== undefined, 'candidate update is required');

interface SessionRequest { anonymousSessionId?: string }

@Controller('v1/conversations/:conversationId/candidates')
@UseGuards(AnonymousSessionGuard)
export class CandidateController {
  constructor(@Inject(CandidateService) private readonly candidates: CandidateService) {}

  @Get()
  async list(@Req() request: SessionRequest, @Param('conversationId') conversationId: string) {
    return { candidates: await this.candidates.list(this.session(request), conversationId) };
  }

  @Post()
  async create(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Body() rawBody: unknown) {
    const parsed = createCandidateSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid candidate');
    return this.candidates.add(this.session(request), conversationId, { ...parsed.data, source: 'user_search' });
  }

  @Patch(':candidateId')
  async update(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Param('candidateId') candidateId: string, @Body() rawBody: unknown) {
    const parsed = patchCandidateSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid candidate update');
    return this.candidates.update(this.session(request), conversationId, candidateId, parsed.data);
  }

  @Delete(':candidateId')
  async remove(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Param('candidateId') candidateId: string) {
    await this.candidates.remove(this.session(request), conversationId, candidateId);
    return { deleted: true };
  }

  private session(request: SessionRequest): string {
    if (!request.anonymousSessionId) throw new ApplicationError('unauthorized');
    return request.anonymousSessionId;
  }
}
