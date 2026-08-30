import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import { InternalServiceAuthGuard, ownerIdFromRequest, type InternalServiceRequest } from '../../internal-auth.js';
import type { StoreTravelerFieldsInput } from './vault.service.js';
import { VaultService } from './vault.service.js';

@Controller('internal/v1/vault/travelers')
@UseGuards(InternalServiceAuthGuard)
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Post(':travelerId/fields')
  async store(
    @Req() request: InternalServiceRequest,
    @Param('travelerId') travelerId: string,
    @Body() body: Omit<StoreTravelerFieldsInput, 'travelerId' | 'ownerId'>,
  ) {
    await this.vault.storeFields({ ...body, ownerId: ownerIdFromRequest(request), travelerId });
    return { travelerId };
  }

  @Delete(':travelerId/fields/:fieldName')
  async remove(
    @Req() request: InternalServiceRequest,
    @Param('travelerId') travelerId: string,
    @Param('fieldName') fieldName: string,
    @Body() body: { deletedAt: string },
  ) {
    await this.vault.deleteField(ownerIdFromRequest(request), travelerId, fieldName, body.deletedAt);
    return { travelerId, fieldName, deleted: true };
  }
}
