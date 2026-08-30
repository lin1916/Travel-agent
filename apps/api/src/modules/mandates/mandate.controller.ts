import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApplicationError, MandateStore } from '@travel/application';
import { TravelMandateSchema, type TravelMandate } from '@travel/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { z } from 'zod';
import { Inject } from '@nestjs/common';
import { MANDATE_STORE } from './mandate.tokens.js';

@Controller()
@UseGuards(AuthGuard)
export class MandateController {
  constructor(@Inject(MANDATE_STORE) private readonly store: MandateStore) {}

  @Post('v1/trips/:tripId/mandates')
  async create(@Param('tripId') tripId: string, @Req() req: AuthenticatedRequest, @Body() body: Omit<TravelMandate, 'version' | 'revokedAt' | 'id'> & { id?: string }): Promise<TravelMandate> {
    const actorId = req.actor?.actorId;
    if (!actorId || body.tripId !== tripId) throw new ApplicationError('forbidden', 'trip ownership required');
    const parsed = TravelMandateSchema.omit({ version: true, revokedAt: true, id: true }).extend({ id: z.string().optional() }).safeParse(body);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message);
    return this.store.create(actorId, { ...parsed.data, id: parsed.data.id ?? randomUUID() } as Omit<TravelMandate, 'version' | 'revokedAt'>, actorId);
  }

  @Get('v1/mandates/:id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<TravelMandate> {
    const found = this.store.get(id, req.actor?.actorId);
    if (!found) throw new ApplicationError('forbidden', 'mandate not found');
    return found;
  }

  @Post('v1/mandates/:id/revoke')
  async revoke(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Headers('if-match-version') version: string | undefined): Promise<TravelMandate> {
    const expected = Number(version);
    if (!Number.isInteger(expected)) throw new ApplicationError('validation_error', 'if-match-version is required');
    try { return this.store.revoke(id, req.actor?.actorId ?? '', expected); } catch (error) { throw new ApplicationError('conflict', error instanceof Error ? error.message : 'mandate conflict'); }
  }
}
