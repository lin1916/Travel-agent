import { describe, expect, it } from 'vitest';
import { ActionRequestService } from '../src/action-requests/action-request-service.js';

describe('action request service', () => {
  it('creates pending requests and consumes an approval once', async () => {
    const service = new ActionRequestService();
    const created = await service.create('owner-1', { tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit', requestedAmount: { amountCents: 100, currency: 'CNY' } }, { correlationId: 'corr-1' });
    expect(created.status).toBe('pending');
    const approved = await service.decide(created.id, 'owner-1', { approved: true, reason: 'go', expectedVersion: created.version });
    expect(approved.status).toBe('approved');
    expect((await service.consume(created.id, 'owner-1', approved.version)).status).toBe('executed');
    await expect(service.consume(created.id, 'owner-1', approved.version)).rejects.toThrow();
  });

  it('enforces owner and version on decisions', async () => {
    const service = new ActionRequestService();
    const created = await service.create('owner-1', { tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit' }, { correlationId: 'corr-2' });
    await expect(service.decide(created.id, 'owner-2', { approved: true, reason: 'no', expectedVersion: created.version })).rejects.toThrow();
    await expect(service.decide(created.id, 'owner-1', { approved: true, reason: 'no', expectedVersion: 99 })).rejects.toThrow();
  });

  it('binds a consumed approval to the command kind, resource, and request hash', async () => {
    const service = new ActionRequestService();
    const created = await service.create('owner-1', { tripId: 'trip-1', resourceId: 'offer-1', kind: 'booking', risk: 'commit' }, { correlationId: 'corr-3' });
    const approved = await service.decide(created.id, 'owner-1', { approved: true, reason: 'go', expectedVersion: created.version });
    await expect(service.consume(created.id, 'owner-1', approved.version, { kind: 'cancel', resourceId: 'offer-1', requestHash: 'wrong' })).rejects.toThrow();
    await expect(service.consume(created.id, 'owner-1', approved.version, { kind: 'booking', resourceId: 'offer-1', requestHash: 'wrong' })).rejects.toThrow();
    await expect(service.consume(created.id, 'owner-1', approved.version, { kind: 'booking', resourceId: 'offer-1', requestHash: await service.requestHash(created.id, 'owner-1') })).resolves.toMatchObject({ status: 'executed' });
  });
});
