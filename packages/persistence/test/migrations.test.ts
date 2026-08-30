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
    ]);
    expect(migrations[3]?.name).toBe('004_agent_runs');
    expect(migrations[4]?.name).toBe('005_agent_run_summaries');
    expect(migrations[5]?.name).toBe('006_vault_refs');
  });
});
