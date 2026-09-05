import type { PlanVersion } from '@travel/contracts';
import type { Kysely } from 'kysely';
import { RepositoryConflictError } from '../types.js';
import type { Database, PlanVersionsTable } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

function redactText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[REDACTED]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '[REDACTED]')
    .replace(/(?:api[_-]?key|access[_-]?token|secret)\s*[=:]\s*\S+/giu, '[REDACTED]');
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'string' ? redactText(item) : item);
}

function fromRows(version: PlanVersionsTable, changeSet: { command: string; summary: string; changed_item_ids_json: string }): PlanVersion {
  return {
    id: version.id,
    tripId: version.trip_id,
    version: version.version,
    createdAt: new Date(version.created_at).toISOString(),
    items: JSON.parse(version.items_json),
    warnings: JSON.parse(version.warnings_json),
    budget: JSON.parse(version.budget_json),
    changeSet: {
      command: changeSet.command as PlanVersion['changeSet']['command'],
      summary: changeSet.summary,
      changedItemIds: JSON.parse(changeSet.changed_item_ids_json),
    },
  };
}

export class PlanRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async append(version: PlanVersion, ownerId: string, tx?: DatabaseTransaction): Promise<void> {
    const connection = tx ?? this.db;
    await this.assertTripOwner(connection, version.tripId, ownerId);
    const current = await connection.selectFrom('plan_versions').select('version')
      .where('trip_id', '=', version.tripId).where('owner_id', '=', ownerId)
      .orderBy('version', 'desc').executeTakeFirst();
    if (current && version.version <= current.version) throw new RepositoryConflictError('plan versions are append-only');
    await connection.insertInto('plan_versions').values({
      id: version.id,
      trip_id: version.tripId,
      owner_id: ownerId,
      version: version.version,
      created_at: version.createdAt,
      items_json: safeJson(version.items),
      warnings_json: safeJson(version.warnings),
      budget_json: safeJson(version.budget),
    }).execute();
    await connection.insertInto('plan_change_sets').values({
      plan_version_id: version.id,
      command: version.changeSet.command,
      summary: redactText(version.changeSet.summary),
      changed_item_ids_json: safeJson(version.changeSet.changedItemIds),
    }).execute();
  }

  async save(version: PlanVersion, ownerId: string, tx?: DatabaseTransaction): Promise<void> {
    return this.append(version, ownerId, tx);
  }

  async current(tripId: string, ownerId: string): Promise<PlanVersion | undefined> {
    const row = await this.db.selectFrom('plan_versions').selectAll()
      .where('trip_id', '=', tripId).where('owner_id', '=', ownerId)
      .orderBy('version', 'desc').executeTakeFirst();
    return row ? this.withChangeSet(row) : undefined;
  }

  async getCurrent(tripId: string, ownerId: string): Promise<PlanVersion | undefined> {
    return this.current(tripId, ownerId);
  }

  async listVersions(tripId: string, ownerId: string): Promise<PlanVersion[]> {
    const rows = await this.db.selectFrom('plan_versions').selectAll()
      .where('trip_id', '=', tripId).where('owner_id', '=', ownerId)
      .orderBy('version').execute();
    return Promise.all(rows.map(row => this.withChangeSet(row)));
  }

  private async withChangeSet(row: PlanVersionsTable): Promise<PlanVersion> {
    const changeSet = await this.db.selectFrom('plan_change_sets').selectAll()
      .where('plan_version_id', '=', row.id).executeTakeFirstOrThrow();
    return fromRows(row, changeSet);
  }

  private async assertTripOwner(connection: Kysely<Database> | DatabaseTransaction, tripId: string, ownerId: string): Promise<void> {
    const trip = await connection.selectFrom('trips').select('owner_id').where('id', '=', tripId).executeTakeFirst();
    if (!trip || trip.owner_id !== ownerId) throw new RepositoryConflictError('trip does not belong to owner');
  }
}

export { PlanRepository as PostgresPlanRepository };
