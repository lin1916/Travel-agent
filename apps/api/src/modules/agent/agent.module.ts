import { Module } from '@nestjs/common';
import { ActionRequestService, SearchService, evaluateExecutionPolicy } from '@travel/application';
import { CapabilityGateway } from '@travel/capability-gateway';
import type { TravelMandate } from '@travel/contracts';
import type { ActionRequestInput, PolicySnapshot } from '@travel/contracts';
import { PlanningOrchestrator, RuleBasedProvider, createPlanningTools } from '@travel/agent-runtime';
import { AgentRunRepository, BudgetRepository, createDatabase } from '@travel/persistence';
import { SearchModule } from '../search/search.module.js';
import { TripModule } from '../trips/trip.module.js';
import { SEARCH_SERVICE } from '../search/search.tokens.js';
import { AgentController } from './agent.controller.js';
import { AGENT_ORCHESTRATOR } from './agent.tokens.js';
import { TRIP_SERVICE } from '../trips/trip.providers.js';
import { MANDATE_STORE } from '../mandates/mandate.tokens.js';
import { ACTION_REQUEST_SERVICE } from '../action-requests/action-request.tokens.js';
import { MandateModule } from '../mandates/mandate.module.js';
import { ActionRequestModule } from '../action-requests/action-request.module.js';

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
  imports: [SearchModule, TripModule, MandateModule, ActionRequestModule],
  controllers: [AgentController],
  providers: [
    {
      provide: AGENT_ORCHESTRATOR,
      inject: [SEARCH_SERVICE, TRIP_SERVICE, MANDATE_STORE, ACTION_REQUEST_SERVICE],
      useFactory: (searchService: SearchService, tripService: { getAny(id: string): Promise<{ id: string; version: number; ownerId: string } | null> }, mandateStore: any, actionRequests: ActionRequestService) => {
        if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') throw new Error('DATABASE_URL is required for durable agent runs');
        const db = process.env.DATABASE_URL ? createDatabase() : undefined;
        const persistence = db ? new AgentRunRepository(db) : undefined;
        const facts: ExecutionPolicyFacts = db ? createExecutionPolicyFacts(db, tripService) : { snapshotFor: async () => null };
        const executionPolicy = createExecutionPolicyEvaluator(mandateStore, actionRequests, facts);
        return new PlanningOrchestrator(new RuleBasedProvider(), new CapabilityGateway(createPlanningTools(searchService), undefined, executionPolicy), persistence, tripService);
      },
    },
  ],
  exports: [AGENT_ORCHESTRATOR],
})
export class AgentModule {}
