import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { TravelerVaultRefStore } from '@travel/persistence';
import { isOpaqueReference } from '@travel/security';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import {
  TRAVELER_VAULT_CLIENT,
  TRAVELER_VAULT_REF_STORE,
  type GrantIssueInput,
  type TravelerVaultClient,
} from './traveler-vault-client.js';

interface StoreFieldsBody {
  travelerId: string;
  fields: Record<string, string>;
  retentionUntil: string;
}

@Controller('v1/travelers')
@UseGuards(AuthGuard)
export class TravelerController {
  constructor(
    @Inject(TRAVELER_VAULT_CLIENT) private readonly vault: TravelerVaultClient,
    @Inject(TRAVELER_VAULT_REF_STORE) private readonly refs: TravelerVaultRefStore,
  ) {}

  @Post()
  async store(@Req() request: AuthenticatedRequest, @Body() body: StoreFieldsBody) {
    if (!isOpaqueReference(body.travelerId)) throw new ForbiddenException('traveler reference is not provider-issued');
    try {
      const stored = await this.vault.storeFields(request.actor!.actorId, body);
      await this.refs.save({
        id: stored.travelerId,
        ownerId: request.actor!.actorId,
        vaultTravelerId: stored.travelerId,
        fieldNames: stored.fieldNames,
        retentionUntil: stored.retentionUntil,
      });
      return stored;
    } catch {
      throw new ServiceUnavailableException('traveler vault is unavailable');
    }
  }

  @Delete(':travelerId/fields/:fieldName')
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('travelerId') travelerId: string,
    @Param('fieldName') fieldName: string,
  ) {
    try {
      const reference = await this.refs.findByVaultTravelerId(travelerId);
      if (!reference
        || reference.ownerId !== request.actor!.actorId
        || reference.deletedAt !== null
        || !reference.fieldNames.includes(fieldName)) {
        throw new ForbiddenException('traveler field is not authorized');
      }
      const result = await this.vault.deleteField(request.actor!.actorId, travelerId, fieldName);
      const marked = await this.refs.markDeleted(request.actor!.actorId, travelerId, new Date().toISOString());
      if (!marked) throw new ForbiddenException('traveler field is not authorized');
      return result;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException('traveler vault is unavailable');
    }
  }
}

@Controller('v1/traveler-data-grants')
@UseGuards(AuthGuard)
export class TravelerGrantController {
  constructor(
    @Inject(TRAVELER_VAULT_CLIENT) private readonly vault: TravelerVaultClient,
    @Inject(TRAVELER_VAULT_REF_STORE) private readonly refs: TravelerVaultRefStore,
  ) {}

  @Post()
  async issue(@Req() request: AuthenticatedRequest, @Body() body: GrantIssueInput) {
    let authorized: boolean;
    try {
      authorized = await this.refs.ownsFields(request.actor!.actorId, body.travelerIds, body.allowedFields);
    } catch {
      throw new ServiceUnavailableException('traveler reference store is unavailable');
    }
    if (!authorized) throw new ForbiddenException('traveler data grant is not authorized');
    try {
      return await this.vault.issueGrant(request.actor!.actorId, body);
    } catch {
      throw new ServiceUnavailableException('traveler grant service is unavailable');
    }
  }

  @Post(':grantId/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Req() request: AuthenticatedRequest,
    @Param('grantId') grantId: string,
    @Body() body: { intentId: string; expiresAt: string; reason: string },
  ) {
    try {
      return await this.vault.revokeGrant(request.actor!.actorId, { id: grantId, ...body });
    } catch {
      throw new ServiceUnavailableException('traveler grant service is unavailable');
    }
  }
}
