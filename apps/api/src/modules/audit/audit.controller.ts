import { Controller, Get, Inject, Param, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { AuditService } from '@travel/application';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');
@Controller('v1/trips')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(@Inject(AUDIT_SERVICE) private readonly audit: AuditService) {}
  @Get(':tripId/audit') list(@Req() request: AuthenticatedRequest, @Param('tripId') tripId: string) {
    const actorId = request.actor?.actorId;
    if (!actorId) throw new UnauthorizedException('actor identity is required');
    return this.audit.listForTrip(tripId, actorId);
  }
}

