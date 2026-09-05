import { describe, expect, it } from 'vitest';
import type {
  PlanProposalDraft,
  PlanningBudgetSummary,
  PlanningContext,
  Place,
} from '@travel/contracts';
import {
  CandidateService,
  InMemoryCandidateRepository,
} from '../src/candidates/candidate-service.js';
import { ApplicationError } from '../src/errors.js';
import { PlanService, type PlanContext, type PlanEvent } from '../src/plans/plan-service.js';
import {
  InMemoryPlanProposalRepository,
  PlanProposalService,
} from '../src/proposals/plan-proposal-service.js';

const planContext: PlanContext = { travelerCount: 2, totalBudgetCents: 500_000 };
const budgetSummary: PlanningBudgetSummary = {
  limit: { amountCents: 500_000, currency: 'CNY' },
  estimatedTotal: { amountCents: 80_000, currency: 'CNY' },
  groupTotal: { amountCents: 80_000, currency: 'CNY' },
  perPerson: { amountCents: 40_000, currency: 'CNY' },
  byCategory: { attraction: { amountCents: 40_000, currency: 'CNY' }, dining: { amountCents: 40_000, currency: 'CNY' } },
  utilizationPercent: 16,
  warnings: [],
};

const firstPlace: Place = {
  id: 'place-1',
  name: '西湖',
  category: '景点',
  address: '浙江省杭州市西湖区',
  city: '杭州',
  latitude: 30.244,
  longitude: 120.149,
  location: { latitude: 30.244, longitude: 120.149, coordinateSystem: 'GCJ-02' },
  coordinateSystem: 'gcj02',
  provider: 'amap',
  providerPlaceId: 'B000A1B2C3',
  sourceUpdatedAt: '2026-09-03T00:00:00.000Z',
};

const secondPlace: Place = {
  ...firstPlace,
  id: 'place-2',
  name: '河坊街',
  providerPlaceId: 'B000D4E5F6',
};

function proposalDraft(overrides: Partial<PlanProposalDraft> = {}): PlanProposalDraft {
  return {
    conversationId: 'conversation-1',
    tripId: 'trip-1',
    planningContextVersion: 1,
    proposedPlaces: [firstPlace, secondPlace],
    itinerary: [
      {
        category: 'attraction',
        title: '西湖',
        startsAt: '2026-10-01T09:00:00.000+08:00',
        endsAt: '2026-10-01T11:00:00.000+08:00',
        location: { city: '杭州' },
        estimatedCostCents: 40_000,
      },
      {
        category: 'dining',
        title: '河坊街午餐',
        startsAt: '2026-10-01T12:00:00.000+08:00',
        endsAt: '2026-10-01T13:00:00.000+08:00',
        location: { city: '杭州' },
        estimatedCostCents: 40_000,
      },
    ],
    budgetSummary,
    warnings: [],
    expiresAt: '2026-09-04T00:00:00.000Z',
    ...overrides,
  };
}

function fixture(options: { publish?: (event: PlanEvent) => void } = {}) {
  let now = new Date('2026-09-03T00:00:00.000Z');
  let candidateId = 0;
  let proposalId = 0;
  let planId = 0;
  let planningContextVersion = 1;
  let conversationTripId = 'trip-1';
  const ownership = {
    assertOwned: async (sessionId: string, conversationId: string) => {
      if (sessionId !== 'session-1' || conversationId !== 'conversation-1') {
        throw new ApplicationError('forbidden', 'conversation belongs to another session');
      }
    },
    get: async (sessionId: string, conversationId: string) => {
      if (sessionId !== 'session-1' || conversationId !== 'conversation-1') {
        throw new ApplicationError('forbidden', 'conversation belongs to another session');
      }
      return { id: conversationId, tripId: conversationTripId };
    },
  };
  const candidateRepository = new InMemoryCandidateRepository();
  const candidates = new CandidateService(candidateRepository, ownership, {
    now: () => now,
    id: () => `candidate-${++candidateId}`,
  });
  const proposalsRepository = new InMemoryPlanProposalRepository();
  const plans = new PlanService({
    now: () => now,
    id: () => `plan-${++planId}`,
    publisher: options.publish ? { publish: options.publish } : undefined,
  });
  const proposals = new PlanProposalService(
    proposalsRepository,
    candidates,
    plans,
    {
      get: async (): Promise<PlanningContext> => ({
        conversationId: 'conversation-1',
        version: planningContextVersion,
        destination: '杭州',
        startsAt: '2026-10-01T00:00:00.000+08:00',
        endsAt: '2026-10-04T00:00:00.000+08:00',
        travelerCount: 2,
        totalBudgetCents: 500_000,
        preferences: [],
        assumptions: [],
        missingFields: [],
        updatedAt: now.toISOString(),
      }),
    },
    ownership,
    { now: () => now, id: () => `proposal-${++proposalId}` },
  );
  return {
    candidates,
    plans,
    proposals,
    proposalsRepository,
    setNow: (value: string) => { now = new Date(value); },
    setPlanningContextVersion: (version: number) => { planningContextVersion = version; },
    setConversationTrip: (tripId: string) => { conversationTripId = tripId; },
  };
}

async function acceptInput(plans: PlanService, expectedProposalVersion: number, overrides: Record<string, unknown> = {}) {
  const current = await plans.current('trip-1', 'session-1', planContext);
  return {
    expectedProposalVersion,
    expectedPlanningContextVersion: 1,
    expectedPlanVersion: current.version,
    idempotencyKey: 'accept-1',
    ...overrides,
  };
}

describe('PlanProposalService', () => {
  it('accepts a multi-night stay with daytime activities and includes the full stay cost', async () => {
    const { proposals, plans } = fixture();
    const draft = proposalDraft();
    draft.itinerary.unshift({
      category: 'stay', title: '三晚住宿估算',
      startsAt: '2026-09-30T14:00:00+08:00', endsAt: '2026-10-03T12:00:00+08:00',
      estimatedCostCents: 240_000, priceScope: 'group',
    });
    const proposal = await proposals.create('session-1', draft);
    const accepted = await proposals.accept('session-1', 'conversation-1', proposal.id, await acceptInput(plans, proposal.version));
    expect(accepted.proposal.status).toBe('accepted');
    expect(accepted.planVersion.items).toHaveLength(3);
    expect(accepted.planVersion.budget.groupTotal.amountCents).toBe(320_000);
    expect(accepted.planVersion.budget.perPerson.amountCents).toBe(160_000);
    expect(accepted.planVersion.warnings).toEqual([]);
  });

  it('uses server-owned review expiry instead of a model-supplied past or unlimited expiry', async () => {
    const { proposals } = fixture();
    const past = await proposals.create('session-1', proposalDraft({ expiresAt: '2020-01-01T00:00:00.000Z' }));
    expect(past.expiresAt).toBe('2026-09-04T00:00:00.000Z');
    await expect(proposals.current('session-1', 'conversation-1')).resolves.toMatchObject({ id: past.id, status: 'pending' });
    const future = await proposals.create('session-1', proposalDraft({ expiresAt: '2099-01-01T00:00:00.000Z' }));
    expect(future.expiresAt).toBe('2026-09-04T00:00:00.000Z');
  });
  it('rejects a same-session proposal for a Trip not linked to the Conversation', async () => {
    const { proposals } = fixture();

    await expect(proposals.create('session-1', proposalDraft({ tripId: 'trip-2' }))).rejects.toMatchObject({ code: 'conflict' });
  });

  it('revalidates the Conversation Trip immediately before accepting', async () => {
    const { candidates, plans, proposals, setConversationTrip } = fixture();
    const plan = await plans.current('trip-1', 'session-1', planContext);
    const created = await proposals.create('session-1', proposalDraft());
    setConversationTrip('trip-2');

    await expect(proposals.accept('session-1', 'conversation-1', created.id, await acceptInput(plans, created.version))).rejects.toMatchObject({ code: 'conflict' });
    await expect(candidates.list('session-1', 'conversation-1')).resolves.toEqual([]);
    await expect(plans.current('trip-1', 'session-1', planContext)).resolves.toMatchObject({ version: plan.version });
  });

  it('rejects proposal itinerary timestamps outside China Standard Time', async () => {
    const { proposals } = fixture();
    const itinerary = proposalDraft().itinerary.map((item, index) => index === 0
      ? { ...item, startsAt: '2026-10-01T01:00:00.000Z', endsAt: '2026-10-01T03:00:00.000Z' }
      : item);

    await expect(proposals.create('session-1', proposalDraft({ itinerary }))).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('keeps agent-proposed places pending until a user accepts one', async () => {
    const { candidates, proposals } = fixture();
    const proposal = await proposals.create('session-1', proposalDraft());

    await expect(candidates.list('session-1', 'conversation-1')).resolves.toEqual([]);
    const accepted = await proposals.acceptPlace('session-1', 'conversation-1', proposal.id, {
      placeId: firstPlace.id,
      expectedProposalVersion: proposal.version,
    });

    expect(accepted).toMatchObject({ place: firstPlace, source: 'accepted_agent_proposal' });
    await expect(candidates.list('session-1', 'conversation-1')).resolves.toEqual([accepted]);
  });

  it('accepts a proposal once, adding remaining candidates and one PlanVersion', async () => {
    const { candidates, plans, proposals } = fixture();
    const created = await proposals.create('session-1', proposalDraft());
    await proposals.acceptPlace('session-1', 'conversation-1', created.id, {
      placeId: firstPlace.id,
      expectedProposalVersion: created.version,
    });
    const pending = await proposals.current('session-1', 'conversation-1');
    const result = await proposals.accept('session-1', 'conversation-1', created.id, await acceptInput(plans, pending!.version));

    expect(result.proposal.status).toBe('accepted');
    expect(result.planVersion).toMatchObject({ version: 2, changeSet: { command: 'accept_proposal' } });
    expect(result.planVersion.items).toHaveLength(2);
    await expect(candidates.list('session-1', 'conversation-1')).resolves.toHaveLength(2);
  });

  it('rejects without writing candidates or a new PlanVersion', async () => {
    const { candidates, plans, proposals } = fixture();
    const current = await plans.current('trip-1', 'session-1', planContext);
    const created = await proposals.create('session-1', proposalDraft());

    await expect(proposals.reject('session-1', 'conversation-1', created.id, created.version)).resolves.toMatchObject({ status: 'rejected' });
    await expect(candidates.list('session-1', 'conversation-1')).resolves.toEqual([]);
    await expect(plans.current('trip-1', 'session-1', planContext)).resolves.toMatchObject({ version: current.version });
  });

  it('rejects stale proposal, planning-context, and plan versions', async () => {
    const staleProposal = fixture();
    const staleProposalCreated = await staleProposal.proposals.create('session-1', proposalDraft());
    await staleProposal.proposals.acceptPlace('session-1', 'conversation-1', staleProposalCreated.id, {
      placeId: firstPlace.id,
      expectedProposalVersion: staleProposalCreated.version,
    });
    await expect(staleProposal.proposals.accept('session-1', 'conversation-1', staleProposalCreated.id, await acceptInput(staleProposal.plans, staleProposalCreated.version))).rejects.toMatchObject({ code: 'conflict' });

    const staleContext = fixture();
    const staleContextCreated = await staleContext.proposals.create('session-1', proposalDraft());
    staleContext.setPlanningContextVersion(2);
    await expect(staleContext.proposals.accept('session-1', 'conversation-1', staleContextCreated.id, await acceptInput(staleContext.plans, staleContextCreated.version))).rejects.toMatchObject({ code: 'conflict' });

    const stalePlan = fixture();
    const stalePlanCreated = await stalePlan.proposals.create('session-1', proposalDraft());
    const initialPlan = await stalePlan.plans.current('trip-1', 'session-1', planContext);
    await stalePlan.plans.execute('trip-1', 'session-1', { kind: 'add', item: proposalDraft().itinerary[0]! }, initialPlan.version, planContext);
    await expect(stalePlan.proposals.accept('session-1', 'conversation-1', stalePlanCreated.id, {
      expectedProposalVersion: stalePlanCreated.version,
      expectedPlanningContextVersion: 1,
      expectedPlanVersion: initialPlan.version,
      idempotencyKey: 'accept-1',
    })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('replays an identical acceptance and rejects an idempotency key reused for a different request', async () => {
    const { plans, proposals } = fixture();
    const created = await proposals.create('session-1', proposalDraft());
    const input = await acceptInput(plans, created.version);
    const first = await proposals.accept('session-1', 'conversation-1', created.id, input);
    const replay = await proposals.accept('session-1', 'conversation-1', created.id, input);

    expect(replay).toEqual(first);
    await expect(proposals.accept('session-1', 'conversation-1', created.id, { ...input, expectedPlanVersion: input.expectedPlanVersion + 1 })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('expires a replaced pending proposal and exposes only the replacement as current', async () => {
    const { proposals, proposalsRepository } = fixture();
    const first = await proposals.create('session-1', proposalDraft());
    const second = await proposals.create('session-1', proposalDraft({ reasoningSummary: 'replacement' }));

    await expect(proposals.current('session-1', 'conversation-1')).resolves.toEqual(second);
    await expect(proposalsRepository.get(first.id)).resolves.toMatchObject({ status: 'expired' });
  });

  it('persists expiry before rejecting reads and acceptance without side effects', async () => {
    const { candidates, plans, proposals, proposalsRepository, setNow } = fixture();
    const plan = await plans.current('trip-1', 'session-1', planContext);
    const created = await proposals.create('session-1', proposalDraft());
    setNow('2026-09-04T00:00:00.000Z');

    await expect(proposals.current('session-1', 'conversation-1')).resolves.toBeUndefined();
    await expect(proposalsRepository.get(created.id)).resolves.toMatchObject({ status: 'expired' });
    await expect(proposals.accept('session-1', 'conversation-1', created.id, await acceptInput(plans, created.version))).rejects.toMatchObject({ code: 'conflict' });
    await expect(candidates.list('session-1', 'conversation-1')).resolves.toEqual([]);
    await expect(plans.current('trip-1', 'session-1', planContext)).resolves.toMatchObject({ version: plan.version });
  });

  it('restores proposal, candidate, and plan state when one acceptance write fails', async () => {
    const { candidates, plans, proposals, proposalsRepository } = fixture({
      publish: event => {
        if (event.redacted_payload.command === 'accept_proposal') throw new Error('event sink unavailable');
      },
    });
    const plan = await plans.current('trip-1', 'session-1', planContext);
    const created = await proposals.create('session-1', proposalDraft());

    await expect(proposals.accept('session-1', 'conversation-1', created.id, await acceptInput(plans, created.version))).rejects.toThrow('event sink unavailable');
    await expect(proposalsRepository.get(created.id)).resolves.toMatchObject({ status: 'pending', version: created.version });
    await expect(candidates.list('session-1', 'conversation-1')).resolves.toEqual([]);
    await expect(plans.current('trip-1', 'session-1', planContext)).resolves.toMatchObject({ version: plan.version });
  });
});
