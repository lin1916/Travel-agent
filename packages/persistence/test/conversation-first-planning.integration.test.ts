import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Conversation, PlanVersion, Place, PlanningContext } from '@travel/contracts';
import { closeDatabase, createDatabase } from '../src/db.js';
import { migrateToLatest } from '../src/migrations/runner.js';
import { AgentRunRepository } from '../src/repositories/agent-run-repository.js';
import { CandidatePlaceRepository } from '../src/repositories/candidate-repository.js';
import { ConversationRepository } from '../src/repositories/conversation-repository.js';
import { PlanProposalRepository, type StoredPlanProposal } from '../src/repositories/plan-proposal-repository.js';
import { PlanRepository } from '../src/repositories/plan-repository.js';
import { PlanningContextRepository } from '../src/repositories/planning-context-repository.js';
import { ProposalAcceptanceRepository } from '../src/repositories/proposal-acceptance-repository.js';

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const integration = hasDatabase ? it : it.skip;
const now = new Date().toISOString();
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const place: Place = {
  id: 'place-west-lake',
  name: 'West Lake',
  category: 'attraction',
  address: 'Hangzhou',
  city: 'Hangzhou',
  latitude: 30.244,
  longitude: 120.149,
  location: { latitude: 30.244, longitude: 120.149, coordinateSystem: 'GCJ-02' },
  coordinateSystem: 'gcj02',
  provider: 'amap',
  providerPlaceId: 'B000A1B2C3',
  sourceUpdatedAt: now,
};

const planItem = {
  category: 'attraction' as const,
  title: 'West Lake',
  startsAt: '2026-10-02T09:00:00+08:00',
  endsAt: '2026-10-02T11:00:00+08:00',
  location: { city: 'Hangzhou' },
  estimatedCostCents: 20_000,
  priceScope: 'group' as const,
};

const budget = {
  limit: { amountCents: 500_000, currency: 'CNY' as const },
  estimatedTotal: { amountCents: 20_000, currency: 'CNY' as const },
  groupTotal: { amountCents: 20_000, currency: 'CNY' as const },
  perPerson: { amountCents: 10_000, currency: 'CNY' as const },
  byCategory: { attraction: { amountCents: 20_000, currency: 'CNY' as const } },
  utilizationPercent: 4,
  warnings: [] as Array<'budget_80_percent' | 'budget_exceeded'>,
};

describe('conversation-first PostgreSQL persistence', () => {
  it('reports the explicit database gate when PostgreSQL is unavailable', () => {
    if (!hasDatabase) expect('DATABASE_URL missing; PostgreSQL integration skipped').toContain('DATABASE_URL missing');
  });

  let db: ReturnType<typeof createDatabase> | undefined;
  beforeAll(async () => {
    if (!hasDatabase) return;
    db = createDatabase();
    await migrateToLatest(db);
  });
  afterAll(async () => {
    if (db) await closeDatabase(db);
  });

  integration('persists the complete planning workspace and atomically accepts one proposal', async () => {
    const database = db!;
    const suffix = Date.now().toString();
    const sessionId = `integration-session-${suffix}`;
    const conversationId = `integration-conversation-${suffix}`;
    const tripId = `integration-trip-${suffix}`;
    const proposalId = `integration-proposal-${suffix}`;
    const runId = `integration-run-${suffix}`;
    const messageId = `integration-message-${suffix}`;
    const clientMessageId = '018f47f2-3a8a-7c71-9d2d-f114dfe66a09';
    const conversationRepository = new ConversationRepository(database);
    const contexts = new PlanningContextRepository(database);
    const candidates = new CandidatePlaceRepository(database);
    const proposals = new PlanProposalRepository(database);
    const plans = new PlanRepository(database);
    const runs = new AgentRunRepository(database);
    let createdTrip = false;

    try {
      await database.insertInto('trips').values({
        id: tripId,
        owner_id: sessionId,
        version: 1,
        destination: 'Hangzhou',
        starts_at: '2026-10-01T00:00:00+08:00',
        ends_at: '2026-10-04T00:00:00+08:00',
        traveler_count: 2,
        created_at: now,
        updated_at: now,
      }).execute();
      createdTrip = true;

      const storedConversation: Conversation & { sessionId: string } = {
        id: conversationId,
        sessionId,
        providerName: 'fixture',
        model: 'fixture',
        status: 'active',
        tripId,
        messages: [{ id: messageId, clientMessageId, role: 'user', content: 'Plan Hangzhou', createdAt: now }],
        createdAt: now,
        updatedAt: now,
        expiresAt,
      };
      await conversationRepository.create(storedConversation);
      const planningContext: PlanningContext & { sessionId: string } = {
        conversationId,
        sessionId,
        version: 1,
        destination: 'Hangzhou',
        startsAt: '2026-10-01T00:00:00+08:00',
        endsAt: '2026-10-04T00:00:00+08:00',
        travelerCount: 2,
        totalBudgetCents: 500_000,
        preferences: ['humanities'],
        assumptions: [],
        missingFields: [],
        updatedAt: now,
      };
      await contexts.create(planningContext);
      await expect(contexts.get(conversationId)).resolves.toMatchObject({ startsAt: '2026-10-01T00:00:00.000+08:00', endsAt: '2026-10-04T00:00:00.000+08:00' });
      await expect(conversationRepository.getForSession(sessionId, conversationId)).resolves.toMatchObject({ messages: [{ clientMessageId }] });
      await expect(conversationRepository.getForSession('other-session', conversationId)).resolves.toBeUndefined();

      await runs.create({
        runId,
        conversationId,
        status: 'completed',
        userMessage: 'Plan Hangzhou',
        planningContext,
        assistantMessage: 'Planning started',
        missingFields: [],
        toolCalls: [],
        actionRequests: [],
        planProposal: null,
        toolCallSummaries: [],
        createdAt: now,
        updatedAt: now,
      });
      expect(await runs.get(runId)).toMatchObject({ conversationId, planningContext: { version: 1 } });

      const initialPlan: PlanVersion = {
        id: `integration-plan-initial-${suffix}`,
        tripId,
        version: 1,
        createdAt: now,
        items: [],
        warnings: [],
        budget: { ...budget, estimatedTotal: { amountCents: 0, currency: 'CNY' }, groupTotal: { amountCents: 0, currency: 'CNY' }, perPerson: { amountCents: 0, currency: 'CNY' }, byCategory: {} },
        changeSet: { command: 'calculate', summary: 'Initialized', changedItemIds: [] },
      };
      await plans.append(initialPlan, sessionId);

      const draft = {
        conversationId,
        tripId,
        planningContextVersion: 1,
        proposedPlaces: [place],
        itinerary: [planItem],
        budgetSummary: budget,
        warnings: [],
        reasoningSummary: 'A compact Hangzhou day.',
        expiresAt,
      };
      const storedProposal: StoredPlanProposal = {
        ...draft,
        id: proposalId,
        version: 1,
        status: 'pending',
        createdAt: now,
        acceptedPlaceIds: [],
        idempotency: {},
      };
      await proposals.create(storedProposal);
      expect(await candidates.list(conversationId)).toEqual([]);

      const nextPlan: PlanVersion = {
        id: `integration-plan-accepted-${suffix}`,
        tripId,
        version: 2,
        createdAt: now,
        items: [{ ...planItem, id: `integration-item-${suffix}`, locked: false }],
        warnings: [],
        budget,
        changeSet: { command: 'accept_proposal', summary: 'Accepted proposal', changedItemIds: [`integration-item-${suffix}`] },
      };
      const result = await new ProposalAcceptanceRepository(database).accept({
        sessionId,
        conversationId,
        proposalId,
        expectedProposalVersion: 1,
        expectedPlanningContextVersion: 1,
        expectedPlanVersion: 1,
        idempotencyKey: `integration-accept-${suffix}`,
        requestFingerprint: JSON.stringify({ expectedProposalVersion: 1, expectedPlanningContextVersion: 1, expectedPlanVersion: 1 }),
        planVersion: nextPlan,
      });
      expect(result.planVersion).toMatchObject({ version: 2, changeSet: { command: 'accept_proposal' } });
      expect(result.candidates).toHaveLength(1);
      expect((await proposals.get(proposalId))?.status).toBe('accepted');
      expect(await candidates.list(conversationId)).toHaveLength(1);
      expect(await plans.listVersions(tripId, sessionId)).toHaveLength(2);

      await database.deleteFrom('anonymous_sessions').where('id', '=', sessionId).execute();
      expect(await database.selectFrom('agent_conversations').select('id').where('id', '=', conversationId).execute()).toEqual([]);
      expect(await database.selectFrom('planning_contexts').select('conversation_id').where('conversation_id', '=', conversationId).execute()).toEqual([]);
      expect(await database.selectFrom('candidate_places').select('id').where('conversation_id', '=', conversationId).execute()).toEqual([]);
      expect(await database.selectFrom('plan_proposals').select('id').where('id', '=', proposalId).execute()).toEqual([]);
      expect(await runs.get(runId)).toBeNull();
    } finally {
      await database.deleteFrom('anonymous_sessions').where('id', '=', sessionId).execute();
      await database.deleteFrom('event_log').where('aggregate_id', '=', conversationId).execute();
      await database.deleteFrom('outbox_events').where('aggregate_id', '=', conversationId).execute();
      if (createdTrip) await database.deleteFrom('trips').where('id', '=', tripId).execute();
    }
  });
});
