import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { InternalServiceAuthGuard, ownerIdFromRequest, type InternalServiceRequest } from '../../internal-auth.js';
import { TravelerDataGrantService, type GrantConsumeContext, type GrantIssueInput, type GrantRef } from './grant.service.js';

@Controller('internal/v1/traveler-data-grants')
@UseGuards(InternalServiceAuthGuard)
export class GrantController {
  constructor(private readonly grants: TravelerDataGrantService) {}

  @Post()
  issue(@Req() request: InternalServiceRequest, @Body() input: GrantIssueInput) {
    return this.grants.issue(input, ownerIdFromRequest(request));
  }

  @Post(':grantId/consume')
  consume(@Param('grantId') id: string, @Body() body: { ref: Omit<GrantRef, 'id'>; context: GrantConsumeContext }) {
    return this.grants.consumeOnce({ id, ...body.ref }, body.context);
  }

  @Post(':grantId/revoke')
  async revoke(
    @Req() request: InternalServiceRequest,
    @Param('grantId') id: string,
    @Body() body: { ref: Omit<GrantRef, 'id'>; reason: string },
  ) {
    await this.grants.revoke({ id, ...body.ref }, body.reason, ownerIdFromRequest(request));
    return { id, revoked: true };
  }
}
