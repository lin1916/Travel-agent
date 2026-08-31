import { Controller, Get, Headers, Inject, Param, UnauthorizedException } from '@nestjs/common';
import type { AuditService } from '@travel/application';
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');
@Controller('v1/trips')
export class AuditController {
  constructor(@Inject(AUDIT_SERVICE) private readonly audit: AuditService) {}
  @Get(':tripId/audit') list(@Headers('x-actor-id') actorId: string | undefined, @Param('tripId') tripId: string) { if (!actorId) throw new UnauthorizedException('actor identity is required'); return this.audit.listForTrip(tripId, actorId); }
}

