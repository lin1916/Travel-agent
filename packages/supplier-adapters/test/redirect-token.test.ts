import { describe, expect, it } from 'vitest';
import { RedirectTokenServiceImpl } from '../src/redirect/redirect-token.js';

describe('signed redirect tokens', () => {
  const context = { intentId: 'intent-1', supplierId: 'supplier-1', nonce: 'nonce-1', issuedAt: '2026-08-30T00:00:00.000Z', expiresAt: '2026-08-30T00:05:00.000Z' };

  it('round-trips only the governed redirect context', async () => {
    const service = new RedirectTokenServiceImpl('test-key');
    const token = await service.issue(context, new Date(context.expiresAt), 'actor-1');
    expect(await service.verify(token, new Date('2026-08-30T00:01:00.000Z'), { actorId: 'actor-1', supplierId: 'supplier-1' })).toEqual(context);
    expect(token).not.toContain('traveler');
  });

  it('requires expected actor and supplier bindings at verification', async () => {
    const service = new RedirectTokenServiceImpl('test-key');
    const token = await service.issue(context, new Date(context.expiresAt), 'actor-1');
    await expect(service.verify(token, new Date('2026-08-30T00:01:00.000Z'), { actorId: 'actor-2', supplierId: 'supplier-1' })).rejects.toThrow(/signature/i);
    await expect(service.verify(token, new Date('2026-08-30T00:01:00.000Z'), { actorId: 'actor-1' })).rejects.toThrow(/supplier binding/i);
  });

  it('rejects altered, expired, and replayed tokens', async () => {
    const service = new RedirectTokenServiceImpl('test-key');
    await expect(service.issue(context, new Date(context.expiresAt))).rejects.toThrow(/actor/i);
    const token = await service.issue(context, new Date(context.expiresAt), 'actor-1');
    await expect(service.verify(`${token}x`, new Date('2026-08-30T00:01:00.000Z'), { actorId: 'actor-1', supplierId: 'supplier-1' })).rejects.toThrow();
    await expect(service.verify(token, new Date('2026-08-30T00:06:00.000Z'), { actorId: 'actor-1', supplierId: 'supplier-1' })).rejects.toThrow(/expired/i);
    await service.verify(token, new Date('2026-08-30T00:01:00.000Z'), { actorId: 'actor-1', supplierId: 'supplier-1' });
    await expect(service.verify(token, new Date('2026-08-30T00:02:00.000Z'), { actorId: 'actor-1', supplierId: 'supplier-1' })).rejects.toThrow(/replay/i);
  });
});
