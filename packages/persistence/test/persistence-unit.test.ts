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
import { InboxRepository } from '../src/inbox/inbox-repository.js';
import { WebhookRepository } from '../src/repositories/webhook-repository.js';

const OPAQUE_TRAVELER_REF = 'traveler-7f4b9d2e1a6c8b3f0d5e7a9c2b4f6d8e';
const OPAQUE_VAULT_REF = 'vault-ref-c9e8d7f6a5b4c3d2e1f0a9b8c7d6e5f4';
const OPAQUE_GRANT_REF = 'grant-1a2b3c4d5e6f7890abcdeffedcba0987';
const OPAQUE_DECISION_REF = 'decision-89abcdef01234567fedcba9876543210';

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
      redacted_payload: { travelerRef: OPAQUE_VAULT_REF },
    });
    expect(row.payload_json).toBe(JSON.stringify({ travelerRef: OPAQUE_VAULT_REF }));
    expect(row.payload_json).not.toContain('身份证');
  });

  it('rejects traveler plaintext fields before durable serialization', () => {
    expect(() => assertDurablePayloadSafe({ orderId: 'order-1', passportNumber: 'plaintext-value' })).toThrow(/sensitive payload field/i);
    expect(() => assertDurablePayloadSafe({ traveler: { fullName: 'plaintext-value' } })).toThrow(/sensitive payload field/i);
    expect(() => assertDurablePayloadSafe({ rawBody: '[REDACTED]' })).toThrow(/sensitive payload field/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: OPAQUE_VAULT_REF, allowedFields: ['fullName'] })).not.toThrow();
  });

  it('rejects unknown plaintext nested in traveler-bound objects while allowing vault references and field metadata', () => {
    expect(() => assertDurablePayloadSafe({ traveler: { profile: { preferredAlias: 'Alice' } } })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: OPAQUE_VAULT_REF, allowedFields: ['fullName'] })).not.toThrow();
  });

  it('rejects plaintext disguised as traveler reference metadata and accepts only opaque reference envelopes', () => {
    expect(() => assertDurablePayloadSafe({ traveler: { purpose: 'Alice Lovelace' } })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ traveler: { travelerVaultRef: 'private name' } })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: OPAQUE_VAULT_REF, purpose: 'Alice Lovelace' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: OPAQUE_VAULT_REF, grantId: 'Alice Lovelace' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: OPAQUE_VAULT_REF, authorizationRef: 'Alice Lovelace' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: OPAQUE_VAULT_REF, travelerIds: ['Alice Lovelace'] })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: OPAQUE_VAULT_REF, travelerCount: 'Alice Lovelace' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({
      travelerVaultRef: OPAQUE_VAULT_REF, grantId: OPAQUE_GRANT_REF, authorizationRef: OPAQUE_DECISION_REF,
      travelerIds: [OPAQUE_TRAVELER_REF], travelerCount: 1, allowedFields: ['fullName'], purpose: 'ticketing',
    })).not.toThrow();
    expect(() => assertDurablePayloadSafe({ traveler: { travelerVaultRef: OPAQUE_VAULT_REF, allowedFields: ['fullName'] } })).not.toThrow();
  });

  it('rejects human-readable nested traveler references and malformed traveler ID arrays', () => {
    expect(() => assertDurablePayloadSafe({
      traveler: { travelerRef: 'vault-ref-Alice-Lovelace' },
    })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({
      traveler: { travelerRef: OPAQUE_VAULT_REF, travelerIds: ['traveler-Jane-Doe'] },
    })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: 'vault-ref-Alice-Lovelace' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerIds: ['traveler-Jane-Doe'] })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerIds: ['traveler-Jane-1'] })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({
      traveler: { travelerRef: OPAQUE_VAULT_REF, travelerIds: 'traveler-1' },
    })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({
      traveler: { travelerRef: OPAQUE_VAULT_REF, travelerIds: Array.from({ length: 17 }, (_, index) => `traveler-${index + 1}`) },
    })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({
      traveler: { travelerRef: OPAQUE_VAULT_REF, travelerIds: [OPAQUE_TRAVELER_REF], travelerCount: 1, allowedFields: ['fullName'], purpose: 'ticketing' },
    })).not.toThrow();
  });

  it('requires UUID or high-entropy opaque references instead of human-readable labels', () => {
    expect(() => assertDurablePayloadSafe({ travelerRef: 'traveler-jane-1' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: 'vault-ref-alice-1' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerRef: 'traveler-1' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: 'vault-ref-1' })).toThrow(/traveler plaintext/i);
    expect(() => assertDurablePayloadSafe({ travelerRef: OPAQUE_TRAVELER_REF })).not.toThrow();
    expect(() => assertDurablePayloadSafe({ travelerVaultRef: '9f6f4f2a-5b7c-4d91-8e23-6a0b1c2d3e4f' })).not.toThrow();
  });

  it('reclaims the raced row identity after an external-event insert conflict', async () => {
    const updatedEventIds: string[] = [];
    let selectCount = 0;
    const selectQuery = () => {
      const query: any = {
        select: () => query,
        where: () => query,
        executeTakeFirst: async () => ++selectCount === 1 ? undefined : { event_id: 'original-event', claim_owner: 'old-owner', claim_until: '2026-08-30T00:00:00.000Z', delivered_at: null },
      };
      return query;
    };
    const updateQuery = () => {
      const query: any = {
        set: () => query,
        where: (column: unknown, _operator?: unknown, value?: unknown) => { if (column === 'event_id') updatedEventIds.push(String(value)); return query; },
        returning: () => query,
        executeTakeFirst: async () => updatedEventIds.at(-1) === 'original-event' ? { event_id: 'original-event' } : undefined,
      };
      return query;
    };
    const db = {
      selectFrom: selectQuery,
      insertInto: () => { const query: any = { values: () => query, execute: async () => { throw new Error('external event conflict'); } }; return query; },
      updateTable: updateQuery,
    } as any;
    const inbox = new InboxRepository(db);

    await expect(inbox.claim('consumer-1', 'new-event', 'new-owner', new Date('2026-08-30T00:00:11.000Z'), 30, 'external-1')).resolves.toBe('claimed');
    expect(updatedEventIds).toContain('original-event');
  });

  it('resolves webhook order identity and writes the receipt/task through the same transaction handle', async () => {
    const txOperations: string[] = [];
    const supplierSelect = { select: () => supplierSelect, where: () => supplierSelect, execute: async () => [{ id: 'local-order-1', payload_json: JSON.stringify({ supplierOrderRef: { supplierId: 'mock-rail', supplierOrderId: 'supplier-order-1' } }) }] };
    const taskSelect = { select: () => taskSelect, where: () => taskSelect, executeTakeFirst: async () => ({ kind: 'webhook_update', payload_json: '{"externalEventId":"external-1","orderId":"local-order-1","orderRef":{"supplierId":"mock-rail","supplierOrderId":"supplier-order-1"},"source":"webhook","supplierId":"mock-rail"}' }) };
    const tx = {
      selectFrom: (table: string) => { txOperations.push(`select:${table}`); return table === 'supplier_orders' ? supplierSelect : taskSelect; },
      insertInto: (table: string) => {
        txOperations.push(`insert:${table}`);
        const query: any = { values: () => query, onConflict: () => query, returning: () => query, execute: async () => undefined, executeTakeFirst: async () => ({ external_event_id: 'external-1' }) };
        return query;
      },
    };
    const db = {
      selectFrom: () => { throw new Error('lookup escaped transaction'); },
      transaction: () => ({ execute: (callback: (connection: unknown) => unknown) => callback(tx) }),
    } as any;
    const repository = new WebhookRepository(db);

    await expect(repository.accept({
      supplierId: 'mock-rail', externalEventId: 'external-1', orderRef: { supplierId: 'mock-rail', supplierOrderId: 'supplier-order-1' },
      payloadHash: 'hash', taskId: 'webhook:mock-rail:external-1', taskPayload: { supplierId: 'mock-rail', externalEventId: 'external-1', orderRef: { supplierId: 'mock-rail', supplierOrderId: 'supplier-order-1' }, source: 'webhook' },
    })).resolves.toBe(true);
    expect(txOperations).toEqual(['select:supplier_orders', 'insert:webhook_receipts', 'insert:tasks', 'select:tasks']);
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
