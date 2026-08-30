import { randomBytes } from 'node:crypto';
import { Aes256GcmEnvelopeCrypto, type KeyProvider } from '@travel/security';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeVaultDatabase,
  createVaultDatabase,
  migrateVaultSchema,
  PostgresVaultRepository,
  type VaultDatabase,
} from '../src/modules/vault/vault.repository.js';
import { VaultService } from '../src/modules/vault/vault.service.js';
import { PostgresGrantRepository, TravelerDataGrantService } from '../src/modules/grants/grant.service.js';
import type { Kysely } from 'kysely';

const databaseUrl = process.env.VAULT_DATABASE_URL;

describe('PostgreSQL Vault configuration', () => {
  it('fails closed when the isolated Vault database URL is missing', () => {
    expect(() => createVaultDatabase(undefined)).toThrow('VAULT_DATABASE_URL is required');
  });
});

describe.skipIf(!databaseUrl)('PostgreSQL Vault boundary', () => {
  let db: Kysely<VaultDatabase>;
  const key = randomBytes(32);
  const provider: KeyProvider = {
    currentKey: async () => ({ key, version: 'postgres-test-v1' }),
    keyForVersion: async version => version === 'postgres-test-v1' ? key : null,
  };

  beforeAll(async () => {
    db = createVaultDatabase(databaseUrl);
    await migrateVaultSchema(db);
  });

  afterAll(async () => closeVaultDatabase(db));

  it('stores ciphertext in the isolated vault schema and decrypts through the service boundary', async () => {
    const repository = new PostgresVaultRepository(db);
    const vault = new VaultService(repository, new Aes256GcmEnvelopeCrypto(provider));
    const travelerId = `postgres-traveler-${Date.now()}`;
    await vault.storeFields({
      travelerId,
      ownerId: 'postgres-owner',
      retentionUntil: '2026-09-30T00:00:00.000Z',
      fields: { fullName: 'Postgres Fixture Traveler' },
    });

    const stored = await db.withSchema('vault').selectFrom('traveler_fields')
      .selectAll().where('traveler_id', '=', travelerId).executeTakeFirstOrThrow();
    expect(JSON.stringify(stored)).not.toContain('Postgres Fixture Traveler');
    await expect(vault.readAuthorizedFields(travelerId, ['fullName'])).resolves.toEqual({
      travelerId, fields: { fullName: 'Postgres Fixture Traveler' },
    });
  });

  it('atomically consumes a SQL-backed grant once under concurrency', async () => {
    const vault = new VaultService(new PostgresVaultRepository(db), new Aes256GcmEnvelopeCrypto(provider));
    const travelerId = `postgres-grant-traveler-${Date.now()}`;
    await vault.storeFields({ travelerId, ownerId: 'postgres-owner',
      retentionUntil: '2026-09-30T00:00:00.000Z', fields: { fullName: 'SQL Grant Traveler' } });
    const now = new Date('2026-08-30T12:00:00.000Z');
    const grants = new TravelerDataGrantService(new PostgresGrantRepository(db), vault, { now: () => now });
    const input = { intentId: `intent-${Date.now()}`, intentVersion: 1, supplierLegalEntity: 'SQL Air',
      travelerIds: [travelerId], allowedFields: ['fullName'], purpose: 'ticketing',
      offerSnapshotHash: 'sha256:sql-offer', authorizationRef: 'decision-sql',
      expiresAt: '2026-08-30T12:04:00.000Z' };
    const ref = await grants.issue(input);
    const context = { ...input };
    delete (context as Partial<typeof context>).expiresAt;

    const outcomes = await Promise.allSettled([
      grants.consumeOnce(ref, context), grants.consumeOnce(ref, context),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
  });
});
