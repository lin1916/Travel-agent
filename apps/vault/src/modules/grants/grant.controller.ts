import { Body, Controller, Param, Post } from '@nestjs/common';
import { TravelerDataGrantService, type GrantConsumeContext, type GrantIssueInput, type GrantRef } from './grant.service.js';

@Controller('internal/v1/traveler-data-grants')
export class GrantController {
  constructor(private readonly grants: TravelerDataGrantService) {}

  @Post()
  issue(@Body() input: GrantIssueInput) {
    return this.grants.issue(input);
  }

  @Post(':grantId/consume')
  consume(@Param('grantId') id: string, @Body() body: { ref: Omit<GrantRef, 'id'>; context: GrantConsumeContext }) {
    return this.grants.consumeOnce({ id, ...body.ref }, body.context);
  }

  @Post(':grantId/revoke')
  async revoke(@Param('grantId') id: string, @Body() body: { ref: Omit<GrantRef, 'id'>; reason: string }) {
    await this.grants.revoke({ id, ...body.ref }, body.reason);
    return { id, revoked: true };
  }
}
