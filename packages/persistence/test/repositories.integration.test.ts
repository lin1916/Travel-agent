import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, closeDatabase } from '../src/db.js';
import { migrateToLatest } from '../src/migrations/runner.js';
import { EventRepository } from '../src/repositories/event-repository.js';
import { TaskRepository } from '../src/repositories/task-repository.js';
import { TripRepository } from '../src/repositories/trip-repository.js';
import { RepositoryConflictError } from '../src/types.js';

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

  it('allocates ordered event sequences and reclaims expired task leases', async () => {
    const aggregateId = 'run-' + Date.now();
    const first = await events.append({
      event_id: aggregateId + '-1',
      event_type: 'AgentRunCreated',
      aggregate_type: 'AgentRun',
      aggregate_id: aggregateId,
      sequence: 1,
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      request_id: 'request-1',
      correlation_id: 'correlation-1',
      redacted_payload: {},
    });
    expect(first.sequence).toBe(1);

    await tasks.enqueue({
      id: aggregateId + '-task',
      kind: 'search',
      payload: { aggregateId },
    });
    const leased = await tasks.lease('worker-1', new Date(), 1);
    expect(leased?.leaseOwner).toBe('worker-1');
    const reclaimed = await tasks.lease('worker-2', new Date(Date.now() + 2_000), 30);
    expect(reclaimed?.leaseOwner).toBe('worker-2');
  });
});
