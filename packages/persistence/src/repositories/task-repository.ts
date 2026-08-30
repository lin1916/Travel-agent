import type { Kysely } from 'kysely';
import { canonicalRequestJson, TaskConflictError, type Database, type EnqueueTaskInput, type LeasedTask, type TaskCompletion } from '../types.js';

export class TaskRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async enqueue(input: EnqueueTaskInput): Promise<void> {
    const now = new Date().toISOString();
    const payloadJson = canonicalRequestJson(input.payload);
    await this.db
      .insertInto('tasks')
      .values({
        id: input.id,
        kind: input.kind,
        status: 'pending',
        payload_json: payloadJson,
        attempts: 0,
        available_at: input.availableAt?.toISOString() ?? now,
        lease_owner: null,
        lease_until: null,
        last_error: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict(oc => oc.column('id').doNothing())
      .execute();

    const existing = await this.db
      .selectFrom('tasks')
      .select(['kind', 'payload_json'])
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (!existing || existing.kind !== input.kind || existing.payload_json !== payloadJson) {
      throw new TaskConflictError(input.id);
    }
  }

  async lease(workerId: string, now: Date, leaseSeconds: number): Promise<LeasedTask | null> {
    return this.db.transaction().execute(async tx => {
      const current = now.toISOString();
      const candidate = await tx
        .selectFrom('tasks')
        .selectAll()
        .where('available_at', '<=', current)
        .where(eb =>
          eb.or([
            eb('status', '=', 'pending'),
            eb.and([eb('status', '=', 'leased'), eb('lease_until', '<=', current)]),
          ]),
        )
        .orderBy('available_at')
        .orderBy('created_at')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) {
        return null;
      }

      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
      await tx
        .updateTable('tasks')
        .set({
          status: 'leased',
          lease_owner: workerId,
          lease_until: leaseUntil,
          attempts: candidate.attempts + 1,
          updated_at: current,
        })
        .where('id', '=', candidate.id)
        .execute();

      return {
        id: candidate.id,
        kind: candidate.kind,
        payload: JSON.parse(candidate.payload_json) as unknown,
        attempts: candidate.attempts + 1,
        leaseOwner: workerId,
        leaseUntil,
      };
    });
  }

  async complete(taskId: string, completion: TaskCompletion): Promise<void> {
    await this.db
      .updateTable('tasks')
      .set({
        status: completion.status,
        lease_owner: null,
        lease_until: null,
        last_error: completion.error ?? null,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', taskId)
      .execute();
  }
}
