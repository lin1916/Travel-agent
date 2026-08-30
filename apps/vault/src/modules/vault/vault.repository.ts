import type { EncryptedValue } from '@travel/security';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

export interface TravelerFieldsTable {
  traveler_id: string;
  owner_id: string;
  field_name: string;
  ciphertext: string;
  nonce: string;
  auth_tag: string;
  key_version: string;
  retention_until: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TravelerDataGrantsTable {
  id: string;
  owner_id: string;
  intent_id: string;
  intent_version: number;
  supplier_legal_entity: string;
  traveler_ids_json: string;
  allowed_fields_json: string;
  purpose: string;
  offer_snapshot_hash: string;
  authorization_ref: string;
  expires_at: string;
  max_uses: number;
  used_at: string | null;
  revoked_at: string | null;
  revocation_reason_hash: string | null;
  created_at: string;
}

export interface VaultDatabase {
  traveler_fields: TravelerFieldsTable;
  traveler_data_grants: TravelerDataGrantsTable;
}

export function createVaultDatabase(databaseUrl = process.env.VAULT_DATABASE_URL): Kysely<VaultDatabase> {
  if (!databaseUrl) throw new Error('VAULT_DATABASE_URL is required');
  return new Kysely<VaultDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: databaseUrl, max: 5 }) }),
  });
}

export async function closeVaultDatabase(db: Kysely<VaultDatabase>): Promise<void> {
  await db.destroy();
}

export async function migrateVaultSchema(db: Kysely<VaultDatabase>): Promise<void> {
  await sql`create schema if not exists vault`.execute(db);
  const schema = db.schema.withSchema('vault');
  await schema.createTable('traveler_fields').ifNotExists()
    .addColumn('traveler_id', 'varchar(128)', col => col.notNull())
    .addColumn('owner_id', 'varchar(128)', col => col.notNull())
    .addColumn('field_name', 'varchar(64)', col => col.notNull())
    .addColumn('ciphertext', 'text', col => col.notNull())
    .addColumn('nonce', 'varchar(128)', col => col.notNull())
    .addColumn('auth_tag', 'varchar(128)', col => col.notNull())
    .addColumn('key_version', 'varchar(128)', col => col.notNull())
    .addColumn('retention_until', 'timestamptz', col => col.notNull())
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('traveler_fields_pk', ['traveler_id', 'field_name'])
    .execute();
  await schema.createIndex('traveler_fields_owner_idx').ifNotExists()
    .on('traveler_fields').column('owner_id').execute();
  await schema.createTable('traveler_data_grants').ifNotExists()
    .addColumn('id', 'varchar(128)', col => col.primaryKey())
    .addColumn('owner_id', 'varchar(128)', col => col.notNull())
    .addColumn('intent_id', 'varchar(128)', col => col.notNull())
    .addColumn('intent_version', 'integer', col => col.notNull())
    .addColumn('supplier_legal_entity', 'varchar(256)', col => col.notNull())
    .addColumn('traveler_ids_json', 'text', col => col.notNull())
    .addColumn('allowed_fields_json', 'text', col => col.notNull())
    .addColumn('purpose', 'varchar(256)', col => col.notNull())
    .addColumn('offer_snapshot_hash', 'varchar(256)', col => col.notNull())
    .addColumn('authorization_ref', 'varchar(128)', col => col.notNull())
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .addColumn('max_uses', 'integer', col => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revocation_reason_hash', 'varchar(128)')
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .execute();
  await schema.createIndex('traveler_data_grants_expiry_idx').ifNotExists()
    .on('traveler_data_grants').column('expires_at').execute();
  await sql.raw('alter table vault.traveler_data_grants add column if not exists owner_id varchar(128)').execute(db);
  await sql.raw("update vault.traveler_data_grants set owner_id = 'system' where owner_id is null").execute(db);
  await sql.raw('alter table vault.traveler_data_grants alter column owner_id set not null').execute(db);
}

export interface VaultFieldRecord extends EncryptedValue {
  travelerId: string;
  ownerId: string;
  fieldName: string;
  retentionUntil: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaultRepository {
  upsertField(record: VaultFieldRecord): Promise<void>;
  findActiveFields(travelerId: string, fieldNames: readonly string[]): Promise<VaultFieldRecord[]>;
  markFieldDeleted(ownerId: string, travelerId: string, fieldName: string, deletedAt: string): Promise<boolean>;
}

function key(travelerId: string, fieldName: string): string {
  return `${travelerId}\u0000${fieldName}`;
}

function clone(record: VaultFieldRecord): VaultFieldRecord {
  return { ...record };
}

export class InMemoryVaultRepository implements VaultRepository {
  private readonly fields = new Map<string, VaultFieldRecord>();

  async upsertField(record: VaultFieldRecord): Promise<void> {
    const existing = this.fields.get(key(record.travelerId, record.fieldName));
    if (existing && existing.ownerId !== record.ownerId) {
      throw new Error('vault field ownership mismatch');
    }
    this.fields.set(key(record.travelerId, record.fieldName), clone(record));
  }

  async findActiveFields(travelerId: string, fieldNames: readonly string[]): Promise<VaultFieldRecord[]> {
    return fieldNames.flatMap(fieldName => {
      const record = this.fields.get(key(travelerId, fieldName));
      return record && record.deletedAt === null ? [clone(record)] : [];
    });
  }

  async markFieldDeleted(
    ownerId: string,
    travelerId: string,
    fieldName: string,
    deletedAt: string,
  ): Promise<boolean> {
    const record = this.fields.get(key(travelerId, fieldName));
    if (!record || record.ownerId !== ownerId || record.deletedAt !== null) return false;
    this.fields.set(key(travelerId, fieldName), { ...record, deletedAt, updatedAt: deletedAt });
    return true;
  }
}

function toRecord(row: TravelerFieldsTable): VaultFieldRecord {
  return {
    travelerId: row.traveler_id,
    ownerId: row.owner_id,
    fieldName: row.field_name,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
    retentionUntil: row.retention_until,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresVaultRepository implements VaultRepository {
  private readonly db: Kysely<VaultDatabase>;

  constructor(db: Kysely<VaultDatabase>) {
    this.db = db.withSchema('vault');
  }

  async upsertField(record: VaultFieldRecord): Promise<void> {
    const stored = await this.db.insertInto('traveler_fields').values({
      traveler_id: record.travelerId,
      owner_id: record.ownerId,
      field_name: record.fieldName,
      ciphertext: record.ciphertext,
      nonce: record.nonce,
      auth_tag: record.authTag,
      key_version: record.keyVersion,
      retention_until: record.retentionUntil,
      deleted_at: record.deletedAt,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }).onConflict(conflict => conflict.columns(['traveler_id', 'field_name']).doUpdateSet({
      ciphertext: record.ciphertext,
      nonce: record.nonce,
      auth_tag: record.authTag,
      key_version: record.keyVersion,
      retention_until: record.retentionUntil,
      deleted_at: record.deletedAt,
      updated_at: record.updatedAt,
    }).where('traveler_fields.owner_id', '=', record.ownerId))
      .returning('traveler_id').executeTakeFirst();
    if (!stored) throw new Error('vault field ownership mismatch');
  }

  async findActiveFields(travelerId: string, fieldNames: readonly string[]): Promise<VaultFieldRecord[]> {
    if (fieldNames.length === 0) return [];
    const rows = await this.db.selectFrom('traveler_fields').selectAll()
      .where('traveler_id', '=', travelerId)
      .where('field_name', 'in', [...fieldNames])
      .where('deleted_at', 'is', null)
      .execute();
    return rows.map(toRecord);
  }

  async markFieldDeleted(ownerId: string, travelerId: string, fieldName: string, deletedAt: string): Promise<boolean> {
    const row = await this.db.updateTable('traveler_fields')
      .set({ deleted_at: deletedAt, updated_at: deletedAt })
      .where('owner_id', '=', ownerId)
      .where('traveler_id', '=', travelerId)
      .where('field_name', '=', fieldName)
      .where('deleted_at', 'is', null)
      .returning('traveler_id').executeTakeFirst();
    return Boolean(row);
  }
}
