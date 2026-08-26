import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db.js';
import { eventToRow, DatabaseConfigurationError } from '../src/types.js';

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
});
