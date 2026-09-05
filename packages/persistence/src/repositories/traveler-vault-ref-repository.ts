import type { Kysely } from 'kysely';
import type { Database, TravelerVaultRefsTable } from '../types.js';

export interface TravelerVaultRef {
  id: string;
  ownerId: string;
  vaultTravelerId: string;
  fieldNames: string[];
  retentionUntil: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewTravelerVaultRef {
  id: string;
  ownerId: string;
  vaultTravelerId: string;
  fieldNames: string[];
  retentionUntil: string;
}

export interface TravelerVaultRefStore {
  save(input: NewTravelerVaultRef): Promise<void>;
  findByVaultTravelerId(vaultTravelerId: string): Promise<TravelerVaultRef | null>;
  countActiveByOwner(ownerId: string): Promise<number>;
  ownsFields(ownerId: string, travelerIds: readonly string[], fieldNames: readonly string[]): Promise<boolean>;
  markDeleted(ownerId: string, vaultTravelerId: string, deletedAt: string): Promise<boolean>;
}

function toRef(row: TravelerVaultRefsTable): TravelerVaultRef {
  return {
    id: row.id,
    ownerId: row.owner_id,
    vaultTravelerId: row.vault_traveler_id,
    fieldNames: JSON.parse(row.field_names_json) as string[],
    retentionUntil: row.retention_until,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clone(ref: TravelerVaultRef): TravelerVaultRef {
  return { ...ref, fieldNames: [...ref.fieldNames] };
}

export class InMemoryTravelerVaultRefRepository implements TravelerVaultRefStore {
  private readonly refs = new Map<string, TravelerVaultRef>();

  async save(input: NewTravelerVaultRef): Promise<void> {
    const existing = this.refs.get(input.vaultTravelerId);
    if (existing && existing.ownerId !== input.ownerId) {
      throw new Error('traveler Vault reference ownership mismatch');
    }
    const now = new Date().toISOString();
    this.refs.set(input.vaultTravelerId, {
      ...input,
      fieldNames: [...input.fieldNames],
      deletedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async findByVaultTravelerId(vaultTravelerId: string): Promise<TravelerVaultRef | null> {
    const ref = this.refs.get(vaultTravelerId);
    return ref ? clone(ref) : null;
  }

  async countActiveByOwner(ownerId: string): Promise<number> { return [...this.refs.values()].filter(ref => ref.ownerId === ownerId && ref.deletedAt === null).length; }

  async ownsFields(ownerId: string, travelerIds: readonly string[], fieldNames: readonly string[]): Promise<boolean> {
    if (travelerIds.length === 0 || fieldNames.length === 0) return false;
    return travelerIds.every(travelerId => {
      const ref = this.refs.get(travelerId);
      return ref?.ownerId === ownerId
        && ref.deletedAt === null
        && fieldNames.every(fieldName => ref.fieldNames.includes(fieldName));
    });
  }

  async markDeleted(ownerId: string, vaultTravelerId: string, deletedAt: string): Promise<boolean> {
    const ref = this.refs.get(vaultTravelerId);
    if (!ref || ref.ownerId !== ownerId || ref.deletedAt !== null) return false;
    this.refs.set(vaultTravelerId, { ...ref, deletedAt, updatedAt: deletedAt });
    return true;
  }
}

export class TravelerVaultRefRepository implements TravelerVaultRefStore {
  constructor(private readonly db: Kysely<Database>) {}

  async save(input: NewTravelerVaultRef): Promise<void> {
    const now = new Date().toISOString();
    const stored = await this.db.insertInto('traveler_vault_refs').values({
      id: input.id,
      owner_id: input.ownerId,
      vault_traveler_id: input.vaultTravelerId,
      field_names_json: JSON.stringify(input.fieldNames),
      retention_until: input.retentionUntil,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    }).onConflict(conflict => conflict.column('vault_traveler_id').doUpdateSet({
      field_names_json: JSON.stringify(input.fieldNames),
      retention_until: input.retentionUntil,
      deleted_at: null,
      updated_at: now,
    }).where('traveler_vault_refs.owner_id', '=', input.ownerId))
      .returning('vault_traveler_id').executeTakeFirst();
    if (!stored) throw new Error('traveler Vault reference ownership mismatch');
  }

  async findByVaultTravelerId(vaultTravelerId: string): Promise<TravelerVaultRef | null> {
    const row = await this.db.selectFrom('traveler_vault_refs').selectAll()
      .where('vault_traveler_id', '=', vaultTravelerId).executeTakeFirst();
    return row ? toRef(row) : null;
  }

  async countActiveByOwner(ownerId: string): Promise<number> {
    const result = await this.db.selectFrom('traveler_vault_refs').select(({ fn }) => fn.countAll<number>().as('count')).where('owner_id', '=', ownerId).where('deleted_at', 'is', null).executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async ownsFields(ownerId: string, travelerIds: readonly string[], fieldNames: readonly string[]): Promise<boolean> {
    if (travelerIds.length === 0 || fieldNames.length === 0) return false;
    const rows = await this.db.selectFrom('traveler_vault_refs').selectAll()
      .where('owner_id', '=', ownerId)
      .where('vault_traveler_id', 'in', [...travelerIds])
      .where('deleted_at', 'is', null)
      .execute();
    if (rows.length !== travelerIds.length) return false;
    return rows.every(row => {
      const storedFields = JSON.parse(row.field_names_json) as string[];
      return fieldNames.every(fieldName => storedFields.includes(fieldName));
    });
  }

  async markDeleted(ownerId: string, vaultTravelerId: string, deletedAt: string): Promise<boolean> {
    const row = await this.db.updateTable('traveler_vault_refs')
      .set({ deleted_at: deletedAt, updated_at: deletedAt })
      .where('owner_id', '=', ownerId)
      .where('vault_traveler_id', '=', vaultTravelerId)
      .where('deleted_at', 'is', null)
      .returning('vault_traveler_id').executeTakeFirst();
    return Boolean(row);
  }
}
