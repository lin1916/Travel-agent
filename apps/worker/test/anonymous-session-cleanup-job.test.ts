import { describe, expect, it } from 'vitest';
import { AnonymousSessionCleanupJob } from '../src/jobs/anonymous-session-cleanup-job.js';

describe('anonymous session cleanup job', () => {
  it('deletes expired sessions idempotently', async () => {
    const calls: string[] = [];
    const job = new AnonymousSessionCleanupJob({
      cleanupExpired: async before => {
        calls.push(before.toISOString());
        return calls.length === 1 ? 2 : 0;
      },
    }, { now: () => new Date('2026-09-10T00:00:00.000Z') });

    await expect(job.runOnce()).resolves.toEqual({ deleted: 2 });
    await expect(job.runOnce()).resolves.toEqual({ deleted: 0 });
    expect(calls).toEqual(['2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z']);
  });
});
