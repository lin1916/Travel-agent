import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyProvider } from './kms.js';

export interface EncryptedValue {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

export interface EnvelopeCrypto {
  encrypt(plaintext: Uint8Array, associatedData: string): Promise<EncryptedValue>;
  decrypt(value: EncryptedValue, associatedData: string): Promise<Uint8Array>;
}

export class Aes256GcmEnvelopeCrypto implements EnvelopeCrypto {
  constructor(private readonly keys: KeyProvider) {}

  async encrypt(plaintext: Uint8Array, associatedData: string): Promise<EncryptedValue> {
    const material = await this.keys.currentKey();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', material.key, nonce);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: material.version,
    };
  }

  async decrypt(value: EncryptedValue, associatedData: string): Promise<Uint8Array> {
    try {
      const key = await this.keys.keyForVersion(value.keyVersion);
      if (!key) throw new Error('key unavailable');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.nonce, 'base64'));
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]);
    } catch {
      throw new Error('encrypted value could not be decrypted');
    }
  }
}
