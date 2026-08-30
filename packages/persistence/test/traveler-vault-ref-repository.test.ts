import { describe, expect, it } from 'vitest';
import { InMemoryTravelerVaultRefRepository } from '../src/repositories/traveler-vault-ref-repository.js';

describe('TravelerVaultRefRepository', () => {
  it('authorizes only the owner and recorded field subset without storing values', async () => {
    const repository = new InMemoryTravelerVaultRefRepository();
    await repository.save({
      id: 'ref-1', ownerId: 'actor-1', vaultTravelerId: 'traveler-1',
      fieldNames: ['fullName', 'passportNumber'], retentionUntil: '2026-09-30T00:00:00.000Z',
    });

    await expect(repository.ownsFields('actor-1', ['traveler-1'], ['fullName'])).resolves.toBe(true);
    await expect(repository.ownsFields('actor-2', ['traveler-1'], ['fullName'])).resolves.toBe(false);
    await expect(repository.ownsFields('actor-1', ['traveler-1'], ['phoneNumber'])).resolves.toBe(false);
    expect(JSON.stringify(await repository.findByVaultTravelerId('traveler-1'))).not.toContain('Ada Lovelace');
  });

  it('does not allow a different owner to overwrite an existing Vault reference', async () => {
    const repository = new InMemoryTravelerVaultRefRepository();
    await repository.save({ id: 'ref-1', ownerId: 'actor-1', vaultTravelerId: 'traveler-1',
      fieldNames: ['fullName'], retentionUntil: '2026-09-30T00:00:00.000Z' });

    await expect(repository.save({ id: 'ref-1', ownerId: 'actor-2', vaultTravelerId: 'traveler-1',
      fieldNames: ['fullName'], retentionUntil: '2026-09-30T00:00:00.000Z' }))
      .rejects.toThrow('traveler Vault reference ownership mismatch');
  });
});
