import { describe, expect, it } from 'vitest';
import { AuditController } from '../src/modules/audit/audit.controller.js';

describe('AuditController actor binding', () => {
  it('uses the authenticated request actor instead of a caller-supplied actor header', async () => {
    const calls: Array<{ tripId: string; actorId: string }> = [];
    const controller = new AuditController({
      listForTrip: async (tripId: string, actorId: string) => {
        calls.push({ tripId, actorId });
        return [];
      },
    } as any);

    await controller.list({ actor: { actorId: 'owner-1' } } as any, 'trip-1');

    expect(calls).toEqual([{ tripId: 'trip-1', actorId: 'owner-1' }]);
  });
});
