import { randomUUID, createHash } from 'node:crypto';
import type { ActionRequestInput, ActionRequestView, ActionRequestStatus, PolicyReason, PolicySnapshot } from '@travel/contracts';
import { ActionRequestInputSchema } from '@travel/contracts';

interface StoredActionRequest extends ActionRequestView {
  ownerId: string; decisionActorId?: string; decisionReason?: string; policySnapshot?: PolicySnapshot; requestHash: string; correlationId: string; consumedAt?: string;
}

export interface ActionRequestCreateOptions { correlationId: string; expiresAt?: string; reasons?: PolicyReason[]; policySnapshot?: PolicySnapshot }
export interface ActionRequestDecision { approved: boolean; reason: string; expectedVersion: number }

export class ActionRequestService {
  private readonly requests = new Map<string, StoredActionRequest>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(ownerId: string, rawInput: ActionRequestInput, options: ActionRequestCreateOptions): Promise<ActionRequestView> {
    const input = ActionRequestInputSchema.parse(rawInput);
    const request: StoredActionRequest = {
      ...structuredClone(input), id: randomUUID(), status: 'pending', version: 1,
      reasons: structuredClone(options.reasons ?? []), expiresAt: options.expiresAt ?? new Date(this.now().getTime() + 5 * 60_000).toISOString(),
      ownerId, policySnapshot: options.policySnapshot ? structuredClone(options.policySnapshot) : undefined,
      requestHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), correlationId: options.correlationId,
    };
    this.requests.set(request.id, request);
    return this.view(request);
  }

  async get(id: string, ownerId: string): Promise<ActionRequestView | null> {
    const request = this.requests.get(id);
    if (!request || request.ownerId !== ownerId) return null;
    this.expire(request);
    return this.view(request);
  }

  async decide(id: string, ownerId: string, decision: ActionRequestDecision): Promise<ActionRequestView> {
    const request = this.authorized(id, ownerId);
    this.expire(request);
    if (request.version !== decision.expectedVersion) throw new Error('action request version changed');
    if (request.status !== 'pending') throw new Error('action request is not pending');
    request.status = decision.approved ? 'approved' : 'rejected';
    request.decisionActorId = ownerId;
    request.decisionReason = decision.reason;
    request.version += 1;
    return this.view(request);
  }

  async consume(id: string, ownerId: string, expectedVersion: number): Promise<ActionRequestView> {
    const request = this.authorized(id, ownerId);
    this.expire(request);
    if (request.version !== expectedVersion) throw new Error('action request version changed');
    if (request.status !== 'approved') throw new Error('action request is not approved');
    request.status = 'executed';
    request.consumedAt = this.now().toISOString();
    request.version += 1;
    return this.view(request);
  }

  private authorized(id: string, ownerId: string): StoredActionRequest {
    const request = this.requests.get(id);
    if (!request) throw new Error('action request not found');
    if (request.ownerId !== ownerId) throw new Error('action request belongs to another actor');
    return request;
  }

  private expire(request: StoredActionRequest): void {
    if ((request.status === 'pending' || request.status === 'approved') && Date.parse(request.expiresAt) <= this.now().getTime()) {
      request.status = 'expired'; request.version += 1;
    }
  }

  private view(request: StoredActionRequest): ActionRequestView {
    const { ownerId: _ownerId, decisionActorId: _decisionActorId, decisionReason: _decisionReason, policySnapshot: _policySnapshot, requestHash: _requestHash, correlationId: _correlationId, consumedAt: _consumedAt, ...view } = request;
    return structuredClone(view);
  }
}
