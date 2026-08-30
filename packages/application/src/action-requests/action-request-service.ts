import { randomUUID, createHash } from 'node:crypto';
import type { ActionRequestInput, ActionRequestView, PolicyReason, PolicySnapshot } from '@travel/contracts';
import { ActionRequestInputSchema } from '@travel/contracts';

export interface ActionRequestRecord extends ActionRequestView {
  ownerId: string; decisionActorId?: string; decisionReason?: string; policySnapshot?: PolicySnapshot;
  requestHash: string; correlationId: string; consumedAt?: string;
}
export interface ActionRequestStore { create(record: ActionRequestRecord): Promise<void>; get(id: string): Promise<ActionRequestRecord | null>; save(record: ActionRequestRecord): Promise<void> }
export class InMemoryActionRequestStore implements ActionRequestStore {
  private readonly records = new Map<string, ActionRequestRecord>();
  async create(record: ActionRequestRecord): Promise<void> { if (this.records.has(record.id)) throw new Error('action request already exists'); this.records.set(record.id, structuredClone(record)); }
  async get(id: string): Promise<ActionRequestRecord | null> { const value = this.records.get(id); return value ? structuredClone(value) : null; }
  async save(record: ActionRequestRecord): Promise<void> { if (!this.records.has(record.id)) throw new Error('action request not found'); this.records.set(record.id, structuredClone(record)); }
}
export interface ActionRequestDecision { approved: boolean; reason: string; expectedVersion: number }
export interface ConsumeBinding { kind: ActionRequestInput['kind']; resourceId: string; requestHash: string }
export interface ActionRequestCreateOptions { correlationId: string; expiresAt?: string; reasons?: PolicyReason[]; policySnapshot?: PolicySnapshot }

export class ActionRequestService {
  constructor(private readonly now: () => Date = () => new Date(), private readonly store: ActionRequestStore = new InMemoryActionRequestStore()) {}
  async create(ownerId: string, rawInput: ActionRequestInput, options: ActionRequestCreateOptions): Promise<ActionRequestView> {
    const input = ActionRequestInputSchema.parse(rawInput);
    const request: ActionRequestRecord = { ...structuredClone(input), id: randomUUID(), status: 'pending', version: 1, reasons: structuredClone(options.reasons ?? []), expiresAt: options.expiresAt ?? new Date(this.now().getTime() + 5 * 60_000).toISOString(), ownerId, policySnapshot: options.policySnapshot ? structuredClone(options.policySnapshot) : undefined, requestHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), correlationId: options.correlationId };
    await this.store.create(request);
    return this.view(request);
  }
  async get(id: string, ownerId: string): Promise<ActionRequestView | null> { const request = await this.store.get(id); if (!request || request.ownerId !== ownerId) return null; this.expire(request); if (request.status === 'expired') await this.store.save(request); return this.view(request); }
  async requestHash(id: string, ownerId: string): Promise<string> { return (await this.authorized(id, ownerId)).requestHash; }
  async getRecord(id: string, ownerId: string): Promise<ActionRequestRecord> { return this.authorized(id, ownerId); }
  async decide(id: string, ownerId: string, decision: ActionRequestDecision): Promise<ActionRequestView> { const request = await this.authorized(id, ownerId); this.expire(request); if (request.version !== decision.expectedVersion) throw new Error('action request version changed'); if (request.status !== 'pending') throw new Error('action request is not pending'); request.status = decision.approved ? 'approved' : 'rejected'; request.decisionActorId = ownerId; request.decisionReason = decision.reason; request.version += 1; await this.store.save(request); return this.view(request); }
  async consume(id: string, ownerId: string, expectedVersion: number, binding?: ConsumeBinding): Promise<ActionRequestView> { const request = await this.authorized(id, ownerId); this.expire(request); if (request.version !== expectedVersion) throw new Error('action request version changed'); if (request.status !== 'approved') throw new Error('action request is not approved'); const actual = binding ?? { kind: request.kind, resourceId: request.resourceId, requestHash: request.requestHash }; if (actual.kind !== request.kind || actual.resourceId !== request.resourceId || actual.requestHash !== request.requestHash) throw new Error('action request command binding mismatch'); request.status = 'executed'; request.consumedAt = this.now().toISOString(); request.version += 1; await this.store.save(request); return this.view(request); }
  private async authorized(id: string, ownerId: string): Promise<ActionRequestRecord> { const request = await this.store.get(id); if (!request) throw new Error('action request not found'); if (request.ownerId !== ownerId) throw new Error('action request belongs to another actor'); return request; }
  private expire(request: ActionRequestRecord): void { if ((request.status === 'pending' || request.status === 'approved') && Date.parse(request.expiresAt) <= this.now().getTime()) { request.status = 'expired'; request.version += 1; } }
  private view(request: ActionRequestRecord): ActionRequestView { const { ownerId: _ownerId, decisionActorId: _decisionActorId, decisionReason: _decisionReason, policySnapshot: _policySnapshot, requestHash: _requestHash, correlationId: _correlationId, consumedAt: _consumedAt, ...view } = request; return structuredClone(view); }
}
