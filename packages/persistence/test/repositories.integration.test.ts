import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, closeDatabase } from '../src/db.js';
import { migrateToLatest } from '../src/migrations/runner.js';
import { EventRepository } from '../src/repositories/event-repository.js';
import { TaskRepository } from '../src/repositories/task-repository.js';
import { TripRepository } from '../src/repositories/trip-repository.js';
import { RepositoryConflictError } from '../src/types.js';
import { withTransaction } from '../src/db.js';
import { ActionRequestRepository } from '../src/repositories/action-request-repository.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('PostgreSQL repositories', () => {
  let db: ReturnType<typeof createDatabase>;
  let trips: TripRepository;
  let events: EventRepository;
  let tasks: TaskRepository;

  beforeAll(async () => {
    db = createDatabase();
    await migrateToLatest(db);
    trips = new TripRepository(db);
    events = new EventRepository(db);
    tasks = new TaskRepository(db);
  });

  afterAll(async () => {
    await closeDatabase(db);
  });

  it('creates and updates a trip only with the expected version', async () => {
    const created = await trips.create({
      id: 'trip-' + Date.now(),
      ownerId: 'owner-1',
      destination: '杭州',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-03T00:00:00.000Z',
      travelerCount: 2,
    });

    expect(created.version).toBe(1);
    const updated = await trips.updateVersioned(created.id, created.ownerId, 1, {
      destination: '苏州',
    });
    expect(updated.version).toBe(2);
    await expect(
      trips.updateVersioned(created.id, created.ownerId, 1, { destination: '南京' }),
    ).rejects.toBeInstanceOf(RepositoryConflictError);
  });

  it('allocates ordered event sequences and reclaims a lease at its expiry', async () => {
    const aggregateId = 'run-' + Date.now();
    const appended = await Promise.all(
      ['AgentRunCreated', 'AgentRunUpdated'].map((eventType, index) =>
        events.append({
          event_id: aggregateId + '-' + (index + 1),
          event_type: eventType,
          aggregate_type: 'AgentRun',
          aggregate_id: aggregateId,
          schema_version: 1,
          occurred_at: new Date().toISOString(),
          request_id: 'request-' + (index + 1),
          correlation_id: 'correlation-1',
          redacted_payload: {},
        }),
      ),
    );
    expect(appended.map(event => event.sequence).sort()).toEqual([1, 2]);

    await tasks.enqueue({
      id: aggregateId + '-task',
      kind: 'search',
      payload: { aggregateId },
    });
    const leaseStart = new Date();
    const leased = await tasks.lease('worker-1', leaseStart, 1);
    expect(leased?.leaseOwner).toBe('worker-1');
    const reclaimed = await tasks.lease('worker-2', new Date(leaseStart.getTime() + 1_000), 30);
    expect(reclaimed?.leaseOwner).toBe('worker-2');
  });

  it('deduplicates identical task replays and rejects conflicting payloads', async () => {
    const taskId = 'search-replay-' + Date.now();
    const payload = { requests: [{ tripId: 'trip-1', kind: 'train' }], mode: 'value' };
    await tasks.enqueue({ id: taskId, kind: 'search', payload });
    await tasks.enqueue({ id: taskId, kind: 'search', payload: { mode: 'value', requests: [{ kind: 'train', tripId: 'trip-1' }] } });
    expect(await db.selectFrom('tasks').select('id').where('id', '=', taskId).execute()).toHaveLength(1);
    await expect(tasks.enqueue({ id: taskId, kind: 'search', payload: { requests: [{ tripId: 'trip-2', kind: 'train' }], mode: 'value' } })).rejects.toThrow('task id conflict');
  });

  it('rolls back a trip mutation and its event together', async () => {
    const tripId = 'trip-transaction-' + Date.now();
    await expect(
      withTransaction(db, async tx => {
        await trips.create(
          {
            id: tripId,
            ownerId: 'owner-transaction',
            destination: '上海',
            startsAt: '2026-09-01T00:00:00.000Z',
            endsAt: '2026-09-03T00:00:00.000Z',
            travelerCount: 2,
          },
          tx,
        );
        await events.appendAndPublishable(tx, {
          event_id: tripId + '-event',
          event_type: 'TripCreated',
          aggregate_type: 'Trip',
          aggregate_id: tripId,
          schema_version: 1,
          occurred_at: new Date().toISOString(),
          request_id: 'request-transaction',
          correlation_id: 'correlation-transaction',
          redacted_payload: {},
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(await trips.getForOwner(tripId, 'owner-transaction')).toBeNull();
    expect(
      await db
        .selectFrom('event_log')
        .select('event_id')
        .where('event_id', '=', tripId + '-event')
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it('rejects an optimistic action-request save when no row was updated', async () => {
    const repository = new ActionRequestRepository({ updateTable: () => ({ set: () => ({ where: () => ({ where: () => ({ execute: async () => [] }) }) }) }) } as any);
    await expect(repository.save({ id: 'ar', tripId: 't', resourceId: 'r', kind: 'booking', risk: 'commit', status: 'approved', reasons: [], expiresAt: new Date().toISOString(), version: 2, ownerId: 'o', requestHash: 'h', correlationId: 'c' })).rejects.toThrow(/conflict/i);
  });
});
