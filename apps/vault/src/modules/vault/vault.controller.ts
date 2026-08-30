import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import type { StoreTravelerFieldsInput } from './vault.service.js';
import { VaultService } from './vault.service.js';

@Controller('internal/v1/vault/travelers')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Post(':travelerId/fields')
  async store(@Param('travelerId') travelerId: string, @Body() body: Omit<StoreTravelerFieldsInput, 'travelerId'>) {
    await this.vault.storeFields({ ...body, travelerId });
    return { travelerId };
  }

  @Delete(':travelerId/fields/:fieldName')
  async remove(
    @Param('travelerId') travelerId: string,
    @Param('fieldName') fieldName: string,
    @Body() body: { ownerId: string; deletedAt: string },
  ) {
    await this.vault.deleteField(body.ownerId, travelerId, fieldName, body.deletedAt);
    return { travelerId, fieldName, deleted: true };
  }
}
