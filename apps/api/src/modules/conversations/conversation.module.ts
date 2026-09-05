import { Module } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  CandidateService,
  ConversationService,
  InMemoryConversationRepository,
  PlanProposalService,
  PlanningContextService,
  type ConversationTurnRunner,
} from '@travel/application';
import { PlanningOrchestrator, resolveAgentRuntimeConfig, type AgentRunPersistence } from '@travel/agent-runtime';
import { EventRepository, ConversationRepository as PostgresConversationRepository, type Database } from '@travel/persistence';
import { API_DATABASE, DatabaseModule } from '../../database.module.js';
import { AGENT_ORCHESTRATOR, PLANNING_AGENT_RUN_STORE } from '../agent/agent.tokens.js';
import { PlanningRuntimeModule } from '../agent/planning-runtime.module.js';
import { AnonymousSessionModule } from '../sessions/anonymous-session.module.js';
import { AnonymousSessionCleanupPort } from './anonymous-session.js';
import { ConversationPlanController } from './conversation-plan.controller.js';
import { CONVERSATION_MODEL, ConversationController } from './conversation.controller.js';
import { InMemoryConversationEventStore } from './conversation-event-store.js';
import { PostgresConversationEventStore } from './postgres-conversation-event-store.js';

const CONVERSATION_TURN_RUNNER = Symbol('CONVERSATION_TURN_RUNNER');
const ANONYMOUS_SESSION_CLEANUP_REGISTRATION = Symbol('ANONYMOUS_SESSION_CLEANUP_REGISTRATION');

@Module({
  imports: [DatabaseModule, AnonymousSessionModule, PlanningRuntimeModule],
  controllers: [ConversationController, ConversationPlanController],
  providers: [
    {
      provide: CONVERSATION_MODEL,
      useFactory: () => {
        const config = resolveAgentRuntimeConfig(process.env);
        return { providerName: config.mode === 'pi' ? 'pi' : 'third-party-responses', model: config.model };
      },
    },
    {
      provide: CONVERSATION_TURN_RUNNER,
      inject: [AGENT_ORCHESTRATOR],
      useFactory: (orchestrator: PlanningOrchestrator): ConversationTurnRunner => ({
        run: async input => {
          const run = await orchestrator.start({
            actorId: input.actorId,
            conversationId: input.conversationId,
            tripId: input.tripId,
            userMessage: input.messages.at(-1)?.content ?? '',
            planningContext: input.planningContext,
            requestedRisk: input.requestedRisk,
            messages: input.messages,
            onEvent: input.onEvent,
          });
          return {
            assistantMessage: run.assistantMessage,
            agentRunId: run.runId,
            tripId: run.tripId,
            planningContext: run.planningContext,
            planProposal: run.planProposal,
            correlationId: run.correlationId,
          };
        },
      }),
    },
    {
      provide: InMemoryConversationEventStore,
      inject: [API_DATABASE],
      useFactory: (db: Kysely<Database> | undefined) => db ? new PostgresConversationEventStore(new EventRepository(db)) : new InMemoryConversationEventStore(),
    },
    {
      provide: ConversationService,
      inject: [
        API_DATABASE,
        CONVERSATION_TURN_RUNNER,
        PLANNING_AGENT_RUN_STORE,
        InMemoryConversationEventStore,
        PlanningContextService,
        CandidateService,
        PlanProposalService,
      ],
      useFactory: (
        db: Kysely<Database> | undefined,
        runner: ConversationTurnRunner,
        runs: AgentRunPersistence,
        events: InMemoryConversationEventStore | PostgresConversationEventStore,
        planningContexts: PlanningContextService,
        candidates: CandidateService,
        proposals: PlanProposalService,
      ) => {
        const repository = db ? new PostgresConversationRepository(db) : new InMemoryConversationRepository();
        return new ConversationService(
          repository,
          runner,
          undefined,
          runs,
          events,
          planningContexts,
          {
            deleteConversation: async (sessionId, conversationId) => {
              await candidates.deleteConversation(sessionId, conversationId);
              await proposals.deleteConversation(sessionId, conversationId);
            },
            purgeConversation: async conversationId => {
              await candidates.purgeConversation(conversationId);
              await proposals.purgeConversation(conversationId);
            },
          },
          proposals,
        );
      },
    },
    {
      provide: ANONYMOUS_SESSION_CLEANUP_REGISTRATION,
      inject: [AnonymousSessionCleanupPort, ConversationService],
      useFactory: (port: AnonymousSessionCleanupPort, conversations: ConversationService) => {
        port.use(conversations);
        return true;
      },
    },
  ],
  exports: [ConversationService, InMemoryConversationEventStore],
})
export class ConversationModule {}
