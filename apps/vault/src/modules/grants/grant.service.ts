import { createHash, randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { TravelerDataGrantsTable, VaultDatabase } from '../vault/vault.repository.js';
import { ALLOWED_TRAVELER_FIELDS, type AuthorizedTravelerFields, type VaultService } from '../vault/vault.service.js';

export interface Clock {
  now(): Date;
}

export interface GrantIssueInput {
  intentId: string;
  intentVersion: number;
  supplierLegalEntity: string;
  travelerIds: string[];
  allowedFields: string[];
  purpose: string;
  offerSnapshotHash: string;
  authorizationRef: string;
  expiresAt: string;
}

export interface GrantConsumeContext {
  intentId: string;
  intentVersion: number;
  supplierLegalEntity: string;
  travelerIds: string[];
  allowedFields: string[];
  purpose: string;
  offerSnapshotHash: string;
  authorizationRef: string;
}

export interface GrantRef {
  id: string;
  intentId: string;
  expiresAt: string;
}

export interface GrantRecord extends GrantIssueInput {
  id: string;
  ownerId: string;
  maxUses: 1;
  usedAt: string | null;
  revokedAt: string | null;
  revocationReasonHash: string | null;
  createdAt: string;
}

export interface GrantRepository {
  create(record: GrantRecord): Promise<void>;
  findById(id: string): Promise<GrantRecord | null>;
  consumeIfAuthorized(ref: GrantRef, context: GrantConsumeContext, now: string): Promise<GrantRecord | null>;
  revoke(id: string, ownerId: string, revokedAt: string, reasonHash: string): Promise<boolean>;
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function contextMatches(record: GrantRecord, context: GrantConsumeContext): boolean {
  return record.intentId === context.intentId
    && record.intentVersion === context.intentVersion
    && record.supplierLegalEntity === context.supplierLegalEntity
    && sameList(record.travelerIds, context.travelerIds)
    && sameList(record.allowedFields, context.allowedFields)
    && record.purpose === context.purpose
    && record.offerSnapshotHash === context.offerSnapshotHash
    && record.authorizationRef === context.authorizationRef;
}

function clone(record: GrantRecord): GrantRecord {
  return { ...record, travelerIds: [...record.travelerIds], allowedFields: [...record.allowedFields] };
}

export class InMemoryGrantRepository implements GrantRepository {
  private readonly records = new Map<string, GrantRecord>();

  async create(record: GrantRecord): Promise<void> {
    if (this.records.has(record.id)) throw new Error('grant id conflict');
    this.records.set(record.id, clone(record));
  }

  async findById(id: string): Promise<GrantRecord | null> {
    const record = this.records.get(id);
    return record ? clone(record) : null;
  }

  async consumeIfAuthorized(ref: GrantRef, context: GrantConsumeContext, now: string): Promise<GrantRecord | null> {
    const record = this.records.get(ref.id);
    if (!record
      || record.intentId !== ref.intentId
      || record.expiresAt !== ref.expiresAt
      || record.usedAt !== null
      || record.revokedAt !== null
      || Date.parse(record.expiresAt) <= Date.parse(now)
      || !contextMatches(record, context)) {
      return null;
    }
    const consumed = { ...record, usedAt: now };
    this.records.set(record.id, consumed);
    return clone(consumed);
  }

  async revoke(id: string, ownerId: string, revokedAt: string, reasonHash: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.ownerId !== ownerId || record.usedAt !== null || record.revokedAt !== null) return false;
    this.records.set(id, { ...record, revokedAt, revocationReasonHash: reasonHash });
    return true;
  }
}

function grantFromRow(row: TravelerDataGrantsTable): GrantRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    intentId: row.intent_id,
    intentVersion: row.intent_version,
    supplierLegalEntity: row.supplier_legal_entity,
    travelerIds: JSON.parse(row.traveler_ids_json) as string[],
    allowedFields: JSON.parse(row.allowed_fields_json) as string[],
    purpose: row.purpose,
    offerSnapshotHash: row.offer_snapshot_hash,
    authorizationRef: row.authorization_ref,
    expiresAt: row.expires_at,
    maxUses: 1,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    revocationReasonHash: row.revocation_reason_hash,
    createdAt: row.created_at,
  };
}

export class PostgresGrantRepository implements GrantRepository {
  private readonly db: Kysely<VaultDatabase>;

  constructor(db: Kysely<VaultDatabase>) {
    this.db = db.withSchema('vault');
  }

  async create(record: GrantRecord): Promise<void> {
    await this.db.insertInto('traveler_data_grants').values({
      id: record.id,
      owner_id: record.ownerId,
      intent_id: record.intentId,
      intent_version: record.intentVersion,
      supplier_legal_entity: record.supplierLegalEntity,
      traveler_ids_json: JSON.stringify(record.travelerIds),
      allowed_fields_json: JSON.stringify(record.allowedFields),
      purpose: record.purpose,
      offer_snapshot_hash: record.offerSnapshotHash,
      authorization_ref: record.authorizationRef,
      expires_at: record.expiresAt,
      max_uses: record.maxUses,
      used_at: record.usedAt,
      revoked_at: record.revokedAt,
      revocation_reason_hash: record.revocationReasonHash,
      created_at: record.createdAt,
    }).execute();
  }

  async findById(id: string): Promise<GrantRecord | null> {
    const row = await this.db.selectFrom('traveler_data_grants').selectAll()
      .where('id', '=', id).executeTakeFirst();
    return row ? grantFromRow(row) : null;
  }

  async consumeIfAuthorized(ref: GrantRef, context: GrantConsumeContext, now: string): Promise<GrantRecord | null> {
    const row = await this.db.updateTable('traveler_data_grants').set({ used_at: now })
      .where('id', '=', ref.id)
      .where('intent_id', '=', ref.intentId)
      .where('expires_at', '=', ref.expiresAt)
      .where('expires_at', '>', now)
      .where('max_uses', '=', 1)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('intent_id', '=', context.intentId)
      .where('intent_version', '=', context.intentVersion)
      .where('supplier_legal_entity', '=', context.supplierLegalEntity)
      .where('traveler_ids_json', '=', JSON.stringify(context.travelerIds))
      .where('allowed_fields_json', '=', JSON.stringify(context.allowedFields))
      .where('purpose', '=', context.purpose)
      .where('offer_snapshot_hash', '=', context.offerSnapshotHash)
      .where('authorization_ref', '=', context.authorizationRef)
      .returningAll().executeTakeFirst();
    return row ? grantFromRow(row) : null;
  }

  async revoke(id: string, ownerId: string, revokedAt: string, reasonHash: string): Promise<boolean> {
    const row = await this.db.updateTable('traveler_data_grants')
      .set({ revoked_at: revokedAt, revocation_reason_hash: reasonHash })
      .where('id', '=', id)
      .where('owner_id', '=', ownerId)
      .where('used_at', 'is', null)
      .where('revoked_at', 'is', null)
      .returning('id').executeTakeFirst();
    return Boolean(row);
  }
}

function validIssueInput(input: GrantIssueInput): boolean {
  return Boolean(input.intentId && input.supplierLegalEntity && input.purpose
    && input.offerSnapshotHash && input.authorizationRef)
    && Number.isInteger(input.intentVersion) && input.intentVersion > 0
    && input.travelerIds.length > 0 && input.travelerIds.length <= 6
    && new Set(input.travelerIds).size === input.travelerIds.length
    && input.allowedFields.length > 0
    && new Set(input.allowedFields).size === input.allowedFields.length
    && input.allowedFields.every(field => ALLOWED_TRAVELER_FIELDS.has(field));
}

export class TravelerDataGrantService {
  constructor(
    private readonly repository: GrantRepository,
    private readonly vault: VaultService,
    private readonly clock: Clock,
  ) {}

  async issue(input: GrantIssueInput, ownerId = 'system'): Promise<GrantRef> {
    const now = this.clock.now();
    const expiresAt = new Date(input.expiresAt);
    if (!validIssueInput(input)
      || Number.isNaN(expiresAt.getTime())
      || expiresAt.getTime() <= now.getTime()
      || expiresAt.getTime() > now.getTime() + 5 * 60 * 1000) {
      throw new Error('grant expiry is invalid');
    }
    const record: GrantRecord = {
      ...input,
      travelerIds: [...input.travelerIds],
      allowedFields: [...input.allowedFields],
      expiresAt: expiresAt.toISOString(),
      id: randomUUID(),
      ownerId,
      maxUses: 1,
      usedAt: null,
      revokedAt: null,
      revocationReasonHash: null,
      createdAt: now.toISOString(),
    };
    await this.repository.create(record);
    return { id: record.id, intentId: record.intentId, expiresAt: record.expiresAt };
  }

  async consumeOnce(ref: GrantRef, context: GrantConsumeContext): Promise<AuthorizedTravelerFields[]> {
    const consumed = await this.repository.consumeIfAuthorized(ref, context, this.clock.now().toISOString());
    if (!consumed) throw new Error('grant is not authorized');
    try {
      return await Promise.all(
        consumed.travelerIds.map(travelerId => this.vault.readAuthorizedFields(travelerId, consumed.allowedFields)),
      );
    } catch {
      throw new Error('authorized traveler fields are unavailable');
    }
  }

  async revoke(ref: GrantRef, reason: string, ownerId = 'system'): Promise<void> {
    const record = await this.repository.findById(ref.id);
    if (!record || record.ownerId !== ownerId || record.intentId !== ref.intentId || record.expiresAt !== ref.expiresAt) {
      throw new Error('grant is not authorized');
    }
    const reasonHash = createHash('sha256').update(reason).digest('hex');
    const revoked = await this.repository.revoke(ref.id, ownerId, this.clock.now().toISOString(), reasonHash);
    if (!revoked) throw new Error('grant is not authorized');
  }
}
