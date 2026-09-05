import { Global, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Kysely } from 'kysely';
import {
  CandidateService,
  ConversationPlanningCoordinator,
  ConversationService,
  InMemoryCandidateRepository,
  InMemoryPlanningContextRepository,
  InMemoryPlanProposalRepository,
  MapService,
  PlanProposalService,
  PlanService,
  PlanningContextService,
  type SearchService,
  type TripService,
} from '@travel/application';
import {
  AgentRunStore,
  PlanningOrchestrator,
  ThirdPartyResponsesProvider,
  createConversationPlanningTools,
  createPlanningRuntime,
  createPlanningTools,
  resolveAgentRuntimeConfig,
  type AgentRunPersistence,
  type LlmProvider,
} from '@travel/agent-runtime';
import { CapabilityGateway } from '@travel/capability-gateway';
import {
  AgentRunRepository,
  CandidatePlaceRepository,
  PlanProposalRepository,
  PlanningContextRepository,
  ProposalAcceptanceRepository,
  type Database,
} from '@travel/persistence';
import { travelMetrics } from '@travel/observability';
import { API_DATABASE, DatabaseModule } from '../../database.module.js';
import { AMapClient } from '../map/amap-client.js';
import { PlanModule, createPlanContextProvider } from '../plans/plan.module.js';
import { SearchModule } from '../search/search.module.js';
import { SEARCH_SERVICE } from '../search/search.tokens.js';
import { TripModule } from '../trips/trip.module.js';
import { BUDGET_SERVICE, TRIP_SERVICE } from '../trips/trip.providers.js';
import { AGENT_ORCHESTRATOR, PLANNING_AGENT_RUN_STORE, PLANNING_GATEWAY, PLANNING_MODEL_FETCH } from './agent.tokens.js';

const PLANNING_MODEL_PROVIDER = Symbol('PLANNING_MODEL_PROVIDER');
const CONVERSATION_MAP = Symbol('CONVERSATION_MAP');
const PROPOSAL_ACCEPTANCE = Symbol('PROPOSAL_ACCEPTANCE');

function ownership(moduleRef: ModuleRef) {
  return {
    assertOwned: (sessionId: string, conversationId: string) => moduleRef.get(ConversationService, { strict: false }).assertOwned(sessionId, conversationId),
    get: (sessionId: string, conversationId: string) => moduleRef.get(ConversationService, { strict: false }).get(sessionId, conversationId),
  };
}

function responsesProvider(fetchImpl: typeof fetch): ThirdPartyResponsesProvider {
  const config = resolveAgentRuntimeConfig(process.env);
  const effort = process.env.TRAVEL_LLM_REASONING_EFFORT ?? 'xhigh';
  if (!['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort)) throw new Error('invalid model reasoning effort');
  return new ThirdPartyResponsesProvider({
    baseUrl: config.baseUrl,
    responsesPath: config.responsesPath,
    apiKey: process.env.TRAVEL_LLM_API_KEY ?? '',
    model: config.model,
    reasoningEffort: effort as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
    timeoutMs: Number(process.env.TRAVEL_LLM_TIMEOUT_MS ?? '30000'),
    fetch: fetchImpl,
  });
}

function durable(db: Kysely<Database> | undefined): boolean {
  return Boolean(db);
}

@Global()
@Module({
  imports: [DatabaseModule, SearchModule, TripModule, PlanModule],
  providers: [
    { provide: PLANNING_MODEL_FETCH, useValue: globalThis.fetch },
    {
      provide: PLANNING_AGENT_RUN_STORE,
      inject: [API_DATABASE],
      useFactory: (db: Kysely<Database> | undefined): AgentRunPersistence => durable(db) ? new AgentRunRepository(db!) as unknown as AgentRunPersistence : new AgentRunStore(),
    },
    {
      provide: PlanningContextService,
      inject: [API_DATABASE, ModuleRef],
      useFactory: (db: Kysely<Database> | undefined, moduleRef: ModuleRef) => new PlanningContextService(
        durable(db) ? new PlanningContextRepository(db!) : new InMemoryPlanningContextRepository(),
        ownership(moduleRef),
      ),
    },
    {
      provide: CandidateService,
      inject: [API_DATABASE, ModuleRef],
      useFactory: (db: Kysely<Database> | undefined, moduleRef: ModuleRef) => new CandidateService(
        durable(db) ? new CandidatePlaceRepository(db!) : new InMemoryCandidateRepository(),
        ownership(moduleRef),
      ),
    },
    {
      provide: PROPOSAL_ACCEPTANCE,
      inject: [API_DATABASE],
      useFactory: (db: Kysely<Database> | undefined) => durable(db) ? new ProposalAcceptanceRepository(db!) : undefined,
    },
    {
      provide: PlanProposalService,
      inject: [API_DATABASE, ModuleRef, CandidateService, PlanService, PlanningContextService, PROPOSAL_ACCEPTANCE],
      useFactory: (
        db: Kysely<Database> | undefined,
        moduleRef: ModuleRef,
        candidates: CandidateService,
        plans: PlanService,
        planningContexts: PlanningContextService,
        acceptance: ProposalAcceptanceRepository | undefined,
      ) => new PlanProposalService(
        durable(db) ? new PlanProposalRepository(db!) : new InMemoryPlanProposalRepository(),
        candidates,
        plans,
        planningContexts,
        ownership(moduleRef),
        undefined,
        acceptance,
      ),
    },
    {
      provide: ConversationPlanningCoordinator,
      inject: [PlanningContextService, TRIP_SERVICE, BUDGET_SERVICE],
      useFactory: (contexts: PlanningContextService, trips: TripService, budgets: { initialize?(tripId: string, totalBudgetCents: number): unknown }) =>
        new ConversationPlanningCoordinator(contexts, trips, budgets.initialize ? { initialize: budgets.initialize.bind(budgets) } : undefined),
    },
    {
      provide: AMapClient,
      useFactory: () => new AMapClient(),
    },
    {
      provide: MapService,
      inject: [AMapClient],
      useFactory: (client: AMapClient) => new MapService(client),
    },
    {
      provide: CONVERSATION_MAP,
      inject: [ModuleRef, MapService],
      useFactory: (moduleRef: ModuleRef, maps: MapService) => ({
        searchPlaces: async (sessionId: string, conversationId: string, query: string) => {
          await ownership(moduleRef).assertOwned(sessionId, conversationId);
          return maps.searchPlaces(query);
        },
      }),
    },
    {
      provide: PLANNING_GATEWAY,
      inject: [ConversationPlanningCoordinator, CONVERSATION_MAP, CandidateService, SEARCH_SERVICE, PlanService, TRIP_SERVICE, BUDGET_SERVICE],
      useFactory: (
        coordinator: ConversationPlanningCoordinator,
        conversationMap: { searchPlaces(sessionId: string, conversationId: string, query: string): Promise<unknown[]> },
        candidates: CandidateService,
        search: SearchService,
        planService: PlanService,
        trips: { getAny(id: string): Promise<{ travelerCount: number } | null> },
        budgets: { get(tripId: string): Promise<{ totalLimit?: { amountCents: number } }> | { totalLimit?: { amountCents: number } } },
      ) => new CapabilityGateway([
        ...createConversationPlanningTools(coordinator, conversationMap as never, candidates),
        ...createPlanningTools(search, planService, createPlanContextProvider(trips, budgets)),
      ]),
    },
    {
      provide: PLANNING_MODEL_PROVIDER,
      inject: [PLANNING_MODEL_FETCH, PLANNING_GATEWAY, PLANNING_AGENT_RUN_STORE, TRIP_SERVICE],
      useFactory: (fetchImpl: typeof fetch, gateway: CapabilityGateway, store: AgentRunPersistence, trips: TripService): LlmProvider =>
        createPlanningRuntime(process.env, {
          gateway,
          store,
          tripReader: trips,
          metrics: travelMetrics,
          legacyProvider: responsesProvider(fetchImpl),
        }).provider,
    },
    {
      provide: AGENT_ORCHESTRATOR,
      inject: [PLANNING_MODEL_PROVIDER, PLANNING_GATEWAY, PLANNING_AGENT_RUN_STORE, TRIP_SERVICE],
      useFactory: (provider: LlmProvider, gateway: CapabilityGateway, store: AgentRunPersistence, trips: TripService) =>
        new PlanningOrchestrator(provider, gateway, store, trips, travelMetrics),
    },
  ],
  exports: [
    PLANNING_AGENT_RUN_STORE,
    PLANNING_GATEWAY,
    PLANNING_MODEL_FETCH,
    AGENT_ORCHESTRATOR,
    PlanningContextService,
    CandidateService,
    PlanProposalService,
    ConversationPlanningCoordinator,
    PlanModule,
    TripModule,
    MapService,
  ],
})
export class PlanningRuntimeModule {}
