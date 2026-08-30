import { describe, expect, it } from 'vitest';
import { createVaultRuntimeDependencies } from '../src/vault.module.js';
import { InternalServiceAuthGuard, createInternalServiceAuthenticator } from '../src/internal-auth.js';

describe('Vault runtime wiring', () => {
  it('does not allow the local key provider in production', () => {
    expect(() => createVaultRuntimeDependencies({
      NODE_ENV: 'production',
      KMS_PROVIDER: 'local',
      VAULT_LOCAL_KEY_BASE64: Buffer.alloc(32).toString('base64'),
      VAULT_LOCAL_KEY_VERSION: 'local-v1',
      VAULT_DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    })).toThrow('local key provider is disabled in production');
  });

  it('requires an explicit internal service token outside the caller body', () => {
    expect(() => createInternalServiceAuthenticator({ NODE_ENV: 'test' })).toThrow(
      'VAULT_INTERNAL_SERVICE_TOKEN is required',
    );
    const authenticator = createInternalServiceAuthenticator({
      NODE_ENV: 'test', VAULT_INTERNAL_SERVICE_TOKEN: 'vault-test-token',
    });
    const guard = new InternalServiceAuthGuard(authenticator);
    expect(authenticator.authenticate('vault-test-token')).toEqual({ serviceId: 'travel-api' });
    expect(() => authenticator.authenticate('attacker-token')).toThrow('internal authentication failed');
  });
});
