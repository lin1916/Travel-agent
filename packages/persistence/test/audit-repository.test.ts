import { describe, expect, it } from 'vitest';
import { auditEntryId } from '../src/repositories/audit-repository.js';

describe('AuditRepository idempotency', () => {
  it('derives a stable id for the same audit command and changes it for a different resource', () => {
    const base = { actorId: 'actor-1', action: 'booking.commit', resource: 'intent-1', requestId: 'request-1', correlationId: 'corr-1' };
    expect(auditEntryId(base)).toBe(auditEntryId({ ...base }));
    expect(auditEntryId(base)).not.toBe(auditEntryId({ ...base, resource: 'intent-2' }));
  });

  it('keeps distinct audit outcomes and timestamps distinct', () => {
    const base = { actorId: 'actor-1', action: 'booking.commit', resource: 'intent-1', requestId: 'request-1', correlationId: 'corr-1', policyResult: 'allow', reason: 'approved', occurredAt: '2026-09-01T00:00:00.000Z' } as any;
    expect(auditEntryId(base)).not.toBe(auditEntryId({ ...base, policyResult: 'deny' }));
    expect(auditEntryId(base)).not.toBe(auditEntryId({ ...base, reason: 'expired' }));
    expect(auditEntryId(base)).not.toBe(auditEntryId({ ...base, occurredAt: '2026-09-01T00:00:01.000Z' }));
  });
});
