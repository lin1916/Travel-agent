import type { EnvelopeCrypto, EncryptedValue } from '@travel/security';
import type { VaultFieldRecord, VaultRepository } from './vault.repository.js';

export const ALLOWED_TRAVELER_FIELDS = new Set([
  'fullName',
  'dateOfBirth',
  'passportNumber',
  'passportExpiry',
  'nationality',
  'phoneNumber',
  'email',
  'loyaltyNumber',
]);

export interface StoreTravelerFieldsInput {
  travelerId: string;
  ownerId: string;
  fields: Record<string, string>;
  retentionUntil: string;
}

export interface AuthorizedTravelerFields {
  travelerId: string;
  fields: Record<string, string>;
}

export interface VaultClock {
  now(): Date;
}

function assertFieldNames(fieldNames: readonly string[]): void {
  if (fieldNames.length === 0 || fieldNames.some(name => !ALLOWED_TRAVELER_FIELDS.has(name))) {
    throw new Error('traveler field is not allowed');
  }
}

function associatedData(record: Pick<VaultFieldRecord, 'ownerId' | 'travelerId' | 'fieldName'>): string {
  return `vault-field:${record.ownerId}:${record.travelerId}:${record.fieldName}`;
}

export class VaultService {
  constructor(
    private readonly repository: VaultRepository,
    private readonly crypto: EnvelopeCrypto,
    private readonly clock: VaultClock = { now: () => new Date() },
  ) {}

  async storeFields(input: StoreTravelerFieldsInput): Promise<void> {
    const entries = Object.entries(input.fields);
    assertFieldNames(entries.map(([fieldName]) => fieldName));
    const now = new Date().toISOString();
    const retentionUntil = new Date(input.retentionUntil);
    if (!input.ownerId || !input.travelerId || Number.isNaN(retentionUntil.getTime())) {
      throw new Error('traveler field metadata is invalid');
    }

    for (const [fieldName, plaintext] of entries) {
      if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('traveler field metadata is invalid');
      }
      const metadata = { ownerId: input.ownerId, travelerId: input.travelerId, fieldName };
      let encrypted: EncryptedValue;
      try {
        encrypted = await this.crypto.encrypt(Buffer.from(plaintext, 'utf8'), associatedData(metadata));
      } catch {
        throw new Error('traveler fields could not be stored');
      }
      await this.repository.upsertField({
        ...metadata,
        ...encrypted,
        retentionUntil: retentionUntil.toISOString(),
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async readAuthorizedFields(
    travelerId: string,
    fieldNames: readonly string[],
  ): Promise<AuthorizedTravelerFields> {
    assertFieldNames(fieldNames);
    const uniqueFields = [...new Set(fieldNames)];
    try {
      const records = await this.repository.findActiveFields(travelerId, uniqueFields);
      if (records.length !== uniqueFields.length) throw new Error('missing field');
      const now = this.clock.now().getTime();
      const fields: Record<string, string> = {};
      for (const fieldName of uniqueFields) {
        const record = records.find(item => item.fieldName === fieldName);
        if (!record) throw new Error('missing field');
        if (Number.isNaN(Date.parse(record.retentionUntil)) || Date.parse(record.retentionUntil) <= now) {
          throw new Error('retention deadline has passed');
        }
        const decrypted = await this.crypto.decrypt(record, associatedData(record));
        fields[fieldName] = Buffer.from(decrypted).toString('utf8');
      }
      return { travelerId, fields };
    } catch {
      throw new Error('authorized traveler fields are unavailable');
    }
  }

  async deleteField(ownerId: string, travelerId: string, fieldName: string, deletedAt: string): Promise<void> {
    assertFieldNames([fieldName]);
    const deleted = await this.repository.markFieldDeleted(ownerId, travelerId, fieldName, deletedAt);
    if (!deleted) throw new Error('traveler field could not be deleted');
  }
}
