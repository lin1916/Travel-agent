import { describe, expect, it } from 'vitest';
import { VaultHttpClient } from '../src/modules/travelers/traveler.module.js';
describe('vault egress policy', () => {
  it('rejects non-HTTPS and private targets before fetch', async () => {
    const client = new VaultHttpClient('http://127.0.0.1:3001');
    await expect(client.storeFields('actor', { travelerId:'traveler-ref-abc1234567890z', fields:{fullName:'x'}, retentionUntil:'2026-09-01T00:00:00.000Z' })).rejects.toThrow();
  });
});
