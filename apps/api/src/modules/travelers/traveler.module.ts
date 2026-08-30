import { Module, ServiceUnavailableException } from '@nestjs/common';
import {
  createDatabase,
  InMemoryTravelerVaultRefRepository,
  TravelerVaultRefRepository,
} from '@travel/persistence';
import { AuthModule } from '../auth/auth.module.js';
import { TravelerController, TravelerGrantController } from './traveler.controller.js';
import {
  TRAVELER_VAULT_CLIENT,
  TRAVELER_VAULT_REF_STORE,
  type GrantIssueInput,
  type TravelerVaultClient,
} from './traveler-vault-client.js';
export {
  TRAVELER_VAULT_CLIENT,
  TRAVELER_VAULT_REF_STORE,
  type TravelerVaultClient,
} from './traveler-vault-client.js';

class VaultHttpClient implements TravelerVaultClient {
  constructor(private readonly baseUrl: string | undefined) {}

  private async post(path: string, body: unknown, method = 'POST'): Promise<unknown> {
    if (!this.baseUrl) throw new ServiceUnavailableException('traveler vault is unavailable');
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new ServiceUnavailableException('traveler vault is unavailable');
    return response.json();
  }

  async storeFields(actorId: string, input: { travelerId: string; fields: Record<string, string>; retentionUntil: string }) {
    await this.post(`/internal/v1/vault/travelers/${encodeURIComponent(input.travelerId)}/fields`, {
      ownerId: actorId, fields: input.fields, retentionUntil: input.retentionUntil,
    });
    return { travelerId: input.travelerId, fieldNames: Object.keys(input.fields), retentionUntil: input.retentionUntil };
  }

  async deleteField(actorId: string, travelerId: string, fieldName: string) {
    await this.post(`/internal/v1/vault/travelers/${encodeURIComponent(travelerId)}/fields/${encodeURIComponent(fieldName)}`, {
      ownerId: actorId, deletedAt: new Date().toISOString(),
    }, 'DELETE');
    return { deleted: true };
  }

  async issueGrant(_actorId: string, input: GrantIssueInput) {
    return await this.post('/internal/v1/traveler-data-grants', input) as { id: string; intentId: string; expiresAt: string };
  }

  async revokeGrant(_actorId: string, input: { id: string; intentId: string; expiresAt: string; reason: string }) {
    const { id, ...body } = input;
    await this.post(`/internal/v1/traveler-data-grants/${encodeURIComponent(id)}/revoke`, {
      ref: { intentId: body.intentId, expiresAt: body.expiresAt }, reason: body.reason,
    });
    return { revoked: true };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [TravelerController, TravelerGrantController],
  providers: [{
    provide: TRAVELER_VAULT_CLIENT,
    useFactory: () => new VaultHttpClient(process.env.VAULT_SERVICE_URL),
  }, {
    provide: TRAVELER_VAULT_REF_STORE,
    useFactory: () => process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL
      ? new InMemoryTravelerVaultRefRepository()
      : new TravelerVaultRefRepository(createDatabase()),
  }],
})
export class TravelerModule {}
