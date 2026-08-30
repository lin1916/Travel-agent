import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';
import {
  canonicalRequestHash,
  canonicalRequestJson,
  eventToRow,
  DatabaseConfigurationError,
  assertDurablePayloadSafe,
} from '../src/types.js';
import { ActionRequestRepository } from '../src/repositories/action-request-repository.js';
import { outboxRowToEnvelope } from '../src/outbox/outbox-repository.js';

describe('persistence boundary helpers', () => {
  it('fails closed when PostgreSQL configuration is absent', () => {
    expect(() => createDatabase(undefined)).toThrow(DatabaseConfigurationError);
  });

  it('stores only the redacted event payload', () => {
    const row = eventToRow({
      event_id: 'event-1',
      event_type: 'AgentRunCreated',
      aggregate_type: 'AgentRun',
      aggregate_id: 'run-1',
      sequence: 1,
      schema_version: 1,
      occurred_at: '2026-08-26T00:00:00.000Z',
      request_id: 'request-1',
      correlation_id: 'correlation-1',
      redacted_payload: { travelerRef: 'vault-ref-1' },
    });
    expect(row.payload_json).toBe(JSON.stringify({ travelerRef: 'vault-ref-1' }));
    expect(row.payload_json).not.toContain('身份证');
  });

  it('rejects traveler plaintext fields before durable serialization', () => {
    expect(() => assertDurablePayloadSafe({ orderId: 'order-1', passportNumber: 'plaintext-value' })).toThrow(/sensitive payload field/i);
    expect(() => assertDurablePayloadSafe({ traveler: { fullName: 'plaintext-value' } })).toThrow(/sensitive payload field/i);
    expect(() => assertDurablePayloadSafe({ rawBody: '[REDACTED]' })).toThrow(/sensitive payload field/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: 'vault-ref-1', allowedFields: ['fullName'] })).not.toThrow();
  });

  it('converts a legacy redacted outbox payload into an EventEnvelope', () => {
    expect(outboxRowToEnvelope({
      event_id: 'event-legacy', event_type: 'BookingIntentCommitted', aggregate_type: 'BookingIntent', aggregate_id: 'intent-1',
      sequence: 1, payload_json: '{"lifecycleStatus":"payment_unknown"}', created_at: '2026-08-29T12:00:00.000Z',
    })).toEqual({
      event_id: 'event-legacy', event_type: 'BookingIntentCommitted', aggregate_type: 'BookingIntent', aggregate_id: 'intent-1',
      sequence: 1, schema_version: 1, occurred_at: '2026-08-29T12:00:00.000Z', request_id: 'legacy:event-legacy',
      correlation_id: 'legacy:event-legacy', redacted_payload: { lifecycleStatus: 'payment_unknown' },
    });
  });

  it('hashes equivalent requests identically regardless of object key order', () => {
    const first = { traveler: { id: 'traveler-1', fields: ['name', 'phone'] }, tripId: 'trip-1' };
    const reordered = { tripId: 'trip-1', traveler: { fields: ['name', 'phone'], id: 'traveler-1' } };

    expect(canonicalRequestJson(first)).toBe(
      '{"traveler":{"fields":["name","phone"],"id":"traveler-1"},"tripId":"trip-1"}',
    );
    expect(canonicalRequestHash(reordered)).toBe(canonicalRequestHash(first));
  });

  it('raises a conflict when action request optimistic update affects zero rows', async () => {
    const db = { updateTable: () => ({ set: () => ({ where: () => ({ where: () => ({ executeTakeFirst: async () => ({ numUpdatedRows: 0 }) }) }) }) }) } as any;
    const repository = new ActionRequestRepository(db);
    await expect(repository.save({ id: 'ar', tripId: 't', resourceId: 'r', kind: 'booking', risk: 'commit', status: 'approved', reasons: [], expiresAt: new Date().toISOString(), version: 2, ownerId: 'o', requestHash: 'h', correlationId: 'c' })).rejects.toThrow(/conflict/i);
  });
});
