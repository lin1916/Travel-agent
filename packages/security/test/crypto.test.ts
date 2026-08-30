import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Aes256GcmEnvelopeCrypto } from '../src/crypto.js';
import { EnvironmentKeyProvider, type KeyProvider } from '../src/kms.js';
import { serializeRedacted } from '../src/redaction.js';

const keyVersion = 'local-v1';
const key = randomBytes(32);

function provider(): KeyProvider {
  return {
    currentKey: async () => ({ key, version: keyVersion }),
    keyForVersion: async version => version === keyVersion ? key : null,
  };
}

describe('AES-256-GCM envelope encryption', () => {
  it('round-trips bytes only with the same associated data', async () => {
    const crypto = new Aes256GcmEnvelopeCrypto(provider());
    const plaintext = Buffer.from('Ada Lovelace / P1234567');

    const encrypted = await crypto.encrypt(plaintext, 'traveler:t-1:passportNumber');
    const decrypted = await crypto.decrypt(encrypted, 'traveler:t-1:passportNumber');

    expect(Buffer.from(decrypted).toString('utf8')).toBe('Ada Lovelace / P1234567');
    await expect(crypto.decrypt(encrypted, 'traveler:t-2:passportNumber')).rejects.toThrow(
      'encrypted value could not be decrypted',
    );
  });

  it('does not place plaintext bytes in the encrypted representation', async () => {
    const crypto = new Aes256GcmEnvelopeCrypto(provider());
    const plaintext = Buffer.from('fixture-traveler-value-48291');

    const encrypted = await crypto.encrypt(plaintext, 'traveler:t-1:fullName');
    const serialized = JSON.stringify(encrypted);

    expect(encrypted.keyVersion).toBe(keyVersion);
    expect(serialized).not.toContain(plaintext.toString('utf8'));
    expect(Buffer.from(encrypted.ciphertext, 'base64').includes(plaintext)).toBe(false);
  });

  it('fails closed when the encrypted key version is unavailable', async () => {
    const crypto = new Aes256GcmEnvelopeCrypto(provider());
    const encrypted = await crypto.encrypt(Buffer.from('value'), 'traveler:t-1:fullName');

    await expect(crypto.decrypt({ ...encrypted, keyVersion: 'retired-v0' }, 'traveler:t-1:fullName'))
      .rejects.toThrow('encrypted value could not be decrypted');
  });
});

describe('environment key provider', () => {
  it('loads an exact 32-byte development key and rejects missing configuration', async () => {
    const configured = EnvironmentKeyProvider.fromEnvironment({
      NODE_ENV: 'development',
      KMS_PROVIDER: 'local',
      VAULT_LOCAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
      VAULT_LOCAL_KEY_VERSION: 'dev-v7',
    });

    await expect(configured.currentKey()).resolves.toMatchObject({ version: 'dev-v7' });
    expect((await configured.currentKey()).key).toHaveLength(32);
    expect(() => EnvironmentKeyProvider.fromEnvironment({ NODE_ENV: 'development' })).toThrow(
      'vault key configuration is unavailable',
    );
    expect(() => EnvironmentKeyProvider.fromEnvironment({
      NODE_ENV: 'production',
      KMS_PROVIDER: 'local',
      VAULT_LOCAL_KEY_BASE64: Buffer.alloc(32).toString('base64'),
      VAULT_LOCAL_KEY_VERSION: 'dev-v1',
    })).toThrow('local key provider is disabled in production');
    expect(() => EnvironmentKeyProvider.fromEnvironment({
      NODE_ENV: 'development',
      KMS_PROVIDER: 'unsupported',
      VAULT_LOCAL_KEY_BASE64: Buffer.alloc(32).toString('base64'),
      VAULT_LOCAL_KEY_VERSION: 'dev-v1',
    })).toThrow('configured key provider is unavailable');
    expect(() => EnvironmentKeyProvider.fromEnvironment({
      NODE_ENV: 'staging',
      KMS_PROVIDER: 'local',
      VAULT_LOCAL_KEY_BASE64: Buffer.alloc(32).toString('base64'),
      VAULT_LOCAL_KEY_VERSION: 'dev-v1',
    })).toThrow('local key provider is disabled outside development/test');
  });
});

describe('sensitive output redaction', () => {
  it('removes traveler values from nested log and event serialization', () => {
    const travelerValue = 'fixture-traveler-value-48291';
    const serialized = serializeRedacted({
      event: 'traveler.updated',
      detail: { message: `updated ${travelerValue}`, fields: [travelerValue] },
    }, [travelerValue]);

    expect(serialized).not.toContain(travelerValue);
    expect(JSON.parse(serialized)).toEqual({
      event: 'traveler.updated',
      detail: { message: 'updated [REDACTED]', fields: ['[REDACTED]'] },
    });
  });
});
