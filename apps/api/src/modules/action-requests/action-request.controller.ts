import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApplicationError, ActionRequestService } from '@travel/application';
import { ActionRequestInputSchema } from '@travel/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { ACTION_REQUEST_SERVICE } from './action-request.tokens.js';

@Controller('v1/action-requests')
@UseGuards(AuthGuard)
export class ActionRequestController {
  constructor(@Inject(ACTION_REQUEST_SERVICE) private readonly service: ActionRequestService) {}

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = ActionRequestInputSchema.safeParse(body);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message);
    return this.service.create(req.actor?.actorId ?? '', parsed.data, { correlationId: req.headers['x-correlation-id']?.toString() ?? 'api' });
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const value = await this.service.get(id, req.actor?.actorId ?? '');
    if (!value) throw new ApplicationError('forbidden', 'action request not found');
    return value;
  }

  @Post(':id/decision')
  async decide(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: { approved: boolean; reason: string; expectedVersion: number }) {
    try { return await this.service.decide(id, req.actor?.actorId ?? '', body); } catch (error) { throw new ApplicationError('conflict', error instanceof Error ? error.message : 'action request conflict'); }
  }
}
