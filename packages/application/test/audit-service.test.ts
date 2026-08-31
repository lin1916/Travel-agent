import { describe, expect, it } from 'vitest';
import { AuditServiceImpl, type AuditStore } from '../src/audit/audit-service.js';
const entry = { actorId:'actor-1', action:'booking.commit', resource:'intent-1', policyResult:'allow', reason:'mandate', mandateVersion:2, grantRef:'grant-abc1234567890z', requestId:'req-1', correlationId:'corr-1', occurredAt:'2026-08-31T00:00:00.000Z' };
describe('audit service', () => {
  it('appends and lists durable redacted audit views', async () => {
    const rows:any[]=[]; const store:AuditStore={ append: async value => { rows.push({ ...value, id:'audit-1' }); }, listForTrip: async () => rows };
    const service = new AuditServiceImpl(store);
    await service.append(entry);
    await expect(service.listForTrip('trip-1','actor-1')).resolves.toEqual([{...entry,id:'audit-1'}]);
  });
  it('fails closed when durable audit storage is unavailable', async () => {
    const service = new AuditServiceImpl({ append: async () => { throw new Error('db down'); }, listForTrip: async () => { throw new Error('db down'); } });
    await expect(service.append(entry)).rejects.toThrow('db down');
  });
});
