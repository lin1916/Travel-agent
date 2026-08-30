import { randomBytes } from 'node:crypto';
import { Aes256GcmEnvelopeCrypto, type KeyProvider } from '@travel/security';
import { describe, expect, it } from 'vitest';
import { InMemoryVaultRepository, type VaultFieldRecord } from '../src/modules/vault/vault.repository.js';
import { VaultService } from '../src/modules/vault/vault.service.js';
import {
  InMemoryGrantRepository,
  TravelerDataGrantService,
  type GrantConsumeContext,
  type GrantIssueInput,
} from '../src/modules/grants/grant.service.js';

const key = randomBytes(32);
const keyProvider: KeyProvider = {
  currentKey: async () => ({ key, version: 'test-v1' }),
  keyForVersion: async version => version === 'test-v1' ? key : null,
};

class FakeClock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  advance(milliseconds: number): void { this.current = new Date(this.current.getTime() + milliseconds); }
}

function createVault() {
  const repository = new InMemoryVaultRepository();
  const service = new VaultService(repository, new Aes256GcmEnvelopeCrypto(keyProvider));
  return { repository, service };
}

async function seedTravelers(service: VaultService): Promise<void> {
  await service.storeFields({
    travelerId: 'traveler-1', ownerId: 'actor-1', retentionUntil: '2026-09-30T00:00:00.000Z',
    fields: { fullName: 'Ada Lovelace', passportNumber: 'P1234567', phoneNumber: '+85255550123' },
  });
  await service.storeFields({
    travelerId: 'traveler-2', ownerId: 'actor-1', retentionUntil: '2026-09-30T00:00:00.000Z',
    fields: { fullName: 'Grace Hopper', passportNumber: 'P7654321' },
  });
}

function issueInput(overrides: Partial<GrantIssueInput> = {}): GrantIssueInput {
  return {
    intentId: 'intent-1', intentVersion: 4, supplierLegalEntity: 'Example Air Limited',
    travelerIds: ['traveler-1', 'traveler-2'], allowedFields: ['fullName', 'passportNumber'],
    purpose: 'issue flight ticket', offerSnapshotHash: 'sha256:offer-1',
    authorizationRef: 'decision-1', expiresAt: '2026-08-30T12:04:00.000Z', ...overrides,
  };
}

function consumeContext(overrides: Partial<GrantConsumeContext> = {}): GrantConsumeContext {
  return {
    intentId: 'intent-1', intentVersion: 4, supplierLegalEntity: 'Example Air Limited',
    travelerIds: ['traveler-1', 'traveler-2'], allowedFields: ['fullName', 'passportNumber'],
    purpose: 'issue flight ticket', offerSnapshotHash: 'sha256:offer-1',
    authorizationRef: 'decision-1', ...overrides,
  };
}

describe('VaultService', () => {
  it('stores one encrypted blob per field with owner, retention, key, and deletion metadata', async () => {
    const { repository, service } = createVault();
    await service.storeFields({
      travelerId: 'traveler-1', ownerId: 'actor-1', retentionUntil: '2026-09-30T00:00:00.000Z',
      fields: { fullName: 'Ada Lovelace', passportNumber: 'P1234567' },
    });

    const records = await repository.findActiveFields('traveler-1', ['fullName', 'passportNumber']);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record).toMatchObject({
        travelerId: 'traveler-1', ownerId: 'actor-1', keyVersion: 'test-v1',
        retentionUntil: '2026-09-30T00:00:00.000Z', deletedAt: null,
      } satisfies Partial<VaultFieldRecord>);
      expect(JSON.stringify(record)).not.toContain('Ada Lovelace');
      expect(JSON.stringify(record)).not.toContain('P1234567');
    }
  });

  it('returns only requested whitelisted fields and excludes deleted fields', async () => {
    const { service } = createVault();
    await seedTravelers(service);

    expect(await service.readAuthorizedFields('traveler-1', ['fullName'])).toEqual({
      travelerId: 'traveler-1', fields: { fullName: 'Ada Lovelace' },
    });
    await service.deleteField('actor-1', 'traveler-1', 'fullName', '2026-08-30T12:00:00.000Z');
    await expect(service.readAuthorizedFields('traveler-1', ['fullName']))
      .rejects.toThrow('authorized traveler fields are unavailable');
    await expect(service.readAuthorizedFields('traveler-1', ['internalNote']))
      .rejects.toThrow('traveler field is not allowed');
  });

  it('fails closed without exposing values when the key provider is unavailable', async () => {
    const { repository, service } = createVault();
    await service.storeFields({ travelerId: 'traveler-1', ownerId: 'actor-1',
      retentionUntil: '2026-09-30T00:00:00.000Z', fields: { fullName: 'Ada Lovelace' } });
    const unavailable: KeyProvider = {
      currentKey: async () => { throw new Error('provider detail'); },
      keyForVersion: async () => { throw new Error('provider detail'); },
    };
    const unavailableService = new VaultService(repository, new Aes256GcmEnvelopeCrypto(unavailable));

    await expect(unavailableService.readAuthorizedFields('traveler-1', ['fullName']))
      .rejects.toThrow('authorized traveler fields are unavailable');
  });
});

describe('TravelerDataGrantService', () => {
  it('rejects caller expiry beyond five minutes and fixes maxUses at one', async () => {
    const clock = new FakeClock(new Date('2026-08-30T12:00:00.000Z'));
    const { service: vault } = createVault();
    const grants = new InMemoryGrantRepository();
    const service = new TravelerDataGrantService(grants, vault, clock);

    await expect(service.issue(issueInput({ expiresAt: '2026-08-30T12:05:00.001Z' })))
      .rejects.toThrow('grant expiry is invalid');
    const ref = await service.issue(issueInput());
    expect(await grants.findById(ref.id)).toMatchObject({ maxUses: 1, usedAt: null, revokedAt: null });
  });

  it('returns minimized fields for multiple travelers only when every binding matches', async () => {
    const clock = new FakeClock(new Date('2026-08-30T12:00:00.000Z'));
    const { service: vault } = createVault();
    await seedTravelers(vault);
    const service = new TravelerDataGrantService(new InMemoryGrantRepository(), vault, clock);
    const ref = await service.issue(issueInput());

    await expect(service.consumeOnce(ref, consumeContext())).resolves.toEqual([
      { travelerId: 'traveler-1', fields: { fullName: 'Ada Lovelace', passportNumber: 'P1234567' } },
      { travelerId: 'traveler-2', fields: { fullName: 'Grace Hopper', passportNumber: 'P7654321' } },
    ]);
  });

  it.each([
    ['intent version', { intentVersion: 3 }], ['supplier', { supplierLegalEntity: 'Different Supplier' }],
    ['traveler list', { travelerIds: ['traveler-1'] }], ['field list', { allowedFields: ['fullName'] }],
    ['purpose', { purpose: 'marketing' }], ['offer snapshot', { offerSnapshotHash: 'sha256:other' }],
    ['authorization', { authorizationRef: 'decision-other' }],
  ])('rejects a mismatched %s binding', async (_name, overrides) => {
    const clock = new FakeClock(new Date('2026-08-30T12:00:00.000Z'));
    const { service: vault } = createVault();
    await seedTravelers(vault);
    const service = new TravelerDataGrantService(new InMemoryGrantRepository(), vault, clock);
    const ref = await service.issue(issueInput());

    await expect(service.consumeOnce(ref, consumeContext(overrides)))
      .rejects.toThrow('grant is not authorized');
  });

  it('rejects expired, revoked, and replayed grants', async () => {
    const clock = new FakeClock(new Date('2026-08-30T12:00:00.000Z'));
    const { service: vault } = createVault();
    await seedTravelers(vault);
    const service = new TravelerDataGrantService(new InMemoryGrantRepository(), vault, clock);

    const expired = await service.issue(issueInput({ expiresAt: '2026-08-30T12:00:01.000Z' }));
    clock.advance(1_001);
    await expect(service.consumeOnce(expired, consumeContext())).rejects.toThrow('grant is not authorized');

    const revoked = await service.issue(issueInput({ expiresAt: '2026-08-30T12:04:00.000Z' }));
    await service.revoke(revoked, 'user withdrew authorization');
    await expect(service.consumeOnce(revoked, consumeContext())).rejects.toThrow('grant is not authorized');

    const once = await service.issue(issueInput({ expiresAt: '2026-08-30T12:04:00.000Z' }));
    await service.consumeOnce(once, consumeContext());
    await expect(service.consumeOnce(once, consumeContext())).rejects.toThrow('grant is not authorized');
  });

  it('atomically allows exactly one of two concurrent consumers', async () => {
    const clock = new FakeClock(new Date('2026-08-30T12:00:00.000Z'));
    const { service: vault } = createVault();
    await seedTravelers(vault);
    const service = new TravelerDataGrantService(new InMemoryGrantRepository(), vault, clock);
    const ref = await service.issue(issueInput());

    const outcomes = await Promise.allSettled([
      service.consumeOnce(ref, consumeContext()), service.consumeOnce(ref, consumeContext()),
    ]);

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
  });
});
