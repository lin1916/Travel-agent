import { Module } from '@nestjs/common';
import { ActionRequestService, evaluateExecutionPolicy } from '@travel/application';
import type { TravelMandate } from '@travel/contracts';
import type { ActionRequestInput, PolicySnapshot } from '@travel/contracts';
import { BudgetRepository, createDatabase } from '@travel/persistence';
import { ConversationModule } from '../conversations/conversation.module.js';
import { AnonymousSessionModule } from '../sessions/anonymous-session.module.js';
import { AgentController } from './agent.controller.js';
import { PlanningRuntimeModule } from './planning-runtime.module.js';

export interface ExecutionPolicyFacts { snapshotFor(command: ActionRequestInput): Promise<PolicySnapshot | null> }
const approvedFields: Array<keyof ActionRequestInput> = ['tripId', 'resourceId', 'kind', 'risk', 'requestedAmount', 'supplierId', 'bookingType', 'refundable', 'offerSnapshotHash', 'requestedSensitiveFields'];
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function createExecutionPolicyFacts(db: ReturnType<typeof createDatabase>, trips: { getAny(id: string): Promise<{ version: number } | null> }): ExecutionPolicyFacts {
  const budgets = new BudgetRepository(db);
  return {
    async snapshotFor(command) {
      const trip = await trips.getAny(command.tripId);
      const currentBudget = await budgets.get(command.tripId);
      if (!trip || !currentBudget) return null;
      const offer = command.kind === 'booking'
        ? await db.selectFrom('offers').select('snapshot_hash').where('trip_id', '=', command.tripId).where('offer_id', '=', command.resourceId).executeTakeFirst()
        : undefined;
      if (command.kind === 'booking' && !offer) return null;
      return { currentTripVersion: trip.version, currentBudget, currentOfferSnapshotHash: offer?.snapshot_hash ?? '', now: new Date().toISOString() };
    },
  };
}

export function createExecutionPolicyEvaluator(mandates: { get(id: string, ownerId?: string): Promise<TravelMandate | null> | TravelMandate | null }, actions: ActionRequestService, facts: ExecutionPolicyFacts) {
  return async (context: { actorId: string; actionRequestId?: string; mandateId?: string }, input: unknown) => {
    if (!context.actionRequestId || !context.mandateId) return { allowed: false, reason: 'latest mandate and single-use action decision are required for external side effects' };
    const request = await actions.getRecord(context.actionRequestId, context.actorId);
    if (request.status !== 'approved' || !request.policySnapshot) return { allowed: false, reason: 'action request is not approved or lacks a policy snapshot' };
    const mandate = await mandates.get(context.mandateId, context.actorId);
    if (!mandate) return { allowed: false, reason: 'mandate not found' };
    const supplied = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    if (approvedFields.some(field => field in supplied && !sameValue(supplied[field], request[field]))) return { allowed: false, reason: 'tool input does not match the approved command' };
    const command: ActionRequestInput = { tripId: request.tripId, resourceId: request.resourceId, kind: request.kind, risk: request.risk, requestedAmount: request.requestedAmount, supplierId: request.supplierId, bookingType: request.bookingType, refundable: request.refundable, offerSnapshotHash: request.offerSnapshotHash, requestedSensitiveFields: request.requestedSensitiveFields };
    const current = await facts.snapshotFor(command);
    if (!current) return { allowed: false, reason: 'current authoritative policy facts are unavailable' };
    const decision = evaluateExecutionPolicy(command, mandate, current);
    if (!decision.allowed || decision.requiresFreshUserDecision) return { allowed: false, reason: decision.reasons.map(item => item.code).join(',') || 'execution policy denied' };
    return { allowed: true, consume: () => actions.consume(request.id, context.actorId, request.version, { kind: request.kind, resourceId: request.resourceId, requestHash: request.requestHash }).then(() => undefined) };
  };
}

@Module({
  imports: [AnonymousSessionModule, PlanningRuntimeModule, ConversationModule],
  controllers: [AgentController],
  exports: [PlanningRuntimeModule],
})
export class AgentModule {}
