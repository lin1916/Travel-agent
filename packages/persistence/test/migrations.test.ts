import { describe, expect, it } from 'vitest';
import { migrations } from '../src/migrations/runner.js';

describe('database migrations', () => {
  it('keeps agent run schema changes forward-only after migration 004', () => {
    expect(migrations.map(migration => migration.name)).toEqual([
      '001_core',
      '002_itinerary_budget',
      '003_offers',
      '004_agent_runs',
      '005_agent_run_summaries',
      '006_vault_refs',
      '007_mandates_actions',
      '008_action_request_consumed_at',
      '009_bookings_orders',
      '010_webhooks_reconciliation',
    ]);
    expect(migrations[3]?.name).toBe('004_agent_runs');
    expect(migrations[4]?.name).toBe('005_agent_run_summaries');
    expect(migrations[5]?.name).toBe('006_vault_refs');
    expect(migrations[6]?.name).toBe('007_mandates_actions');
    expect(migrations[7]?.name).toBe('008_action_request_consumed_at');
    expect(migrations[8]?.name).toBe('009_bookings_orders');
    expect(migrations[9]?.name).toBe('010_webhooks_reconciliation');
  });
});
