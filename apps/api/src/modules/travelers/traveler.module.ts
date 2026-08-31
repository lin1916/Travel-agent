import { Module, ServiceUnavailableException } from '@nestjs/common';
import { isAllowedOutboundUrl, supplierRequestOptions } from '@travel/security';
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

export class VaultHttpClient implements TravelerVaultClient {
  constructor(private readonly baseUrl: string | undefined, private readonly allowlist: readonly string[] = (process.env.VAULT_ALLOWED_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean), private readonly timeoutMs = Number(process.env.VAULT_REQUEST_TIMEOUT_MS ?? 5000)) {}

  private async post(path: string, body: unknown, method = 'POST', ownerId?: string): Promise<unknown> {
    if (!this.baseUrl || !isAllowedOutboundUrl(this.baseUrl, this.allowlist)) throw new ServiceUnavailableException('traveler vault is unavailable');
    const serviceToken = process.env.VAULT_INTERNAL_SERVICE_TOKEN;
    if (!serviceToken) throw new ServiceUnavailableException('traveler vault is unavailable');
    const timeout = supplierRequestOptions(this.timeoutMs);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-vault-service-token': serviceToken,
        ...(ownerId ? { 'x-vault-owner-id': ownerId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout.timeoutMs),
    });
    if (!response.ok) throw new ServiceUnavailableException('traveler vault is unavailable');
    return response.json();
  }

  async storeFields(actorId: string, input: { travelerId: string; fields: Record<string, string>; retentionUntil: string }) {
    await this.post(`/internal/v1/vault/travelers/${encodeURIComponent(input.travelerId)}/fields`, {
      fields: input.fields, retentionUntil: input.retentionUntil,
    }, 'POST', actorId);
    return { travelerId: input.travelerId, fieldNames: Object.keys(input.fields), retentionUntil: input.retentionUntil };
  }

  async deleteField(actorId: string, travelerId: string, fieldName: string) {
    await this.post(`/internal/v1/vault/travelers/${encodeURIComponent(travelerId)}/fields/${encodeURIComponent(fieldName)}`, {
      deletedAt: new Date().toISOString(),
    }, 'DELETE', actorId);
    return { deleted: true };
  }

  async issueGrant(actorId: string, input: GrantIssueInput) {
    return await this.post('/internal/v1/traveler-data-grants', input, 'POST', actorId) as { id: string; intentId: string; expiresAt: string };
  }

  async revokeGrant(actorId: string, input: { id: string; intentId: string; expiresAt: string; reason: string }) {
    const { id, ...body } = input;
    await this.post(`/internal/v1/traveler-data-grants/${encodeURIComponent(id)}/revoke`, {
      ref: { intentId: body.intentId, expiresAt: body.expiresAt }, reason: body.reason,
    }, 'POST', actorId);
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
