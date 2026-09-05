import {
  PlanningContextPatchSchema,
  type PlanningContext,
  type PlanningContextField,
  type PlanningContextPatch,
  type TripDraft,
} from '@travel/contracts';
import { validateTrip } from '@travel/domain';
import { ApplicationError } from '../errors.js';

export interface StoredPlanningContext extends PlanningContext {
  sessionId: string;
}

export interface ConversationOwnershipPort {
  assertOwned(sessionId: string, conversationId: string): Promise<void>;
}

export interface PlanningContextRepository {
  create(record: StoredPlanningContext): Promise<void>;
  get(conversationId: string): Promise<StoredPlanningContext | undefined>;
  save(record: StoredPlanningContext, expectedVersion: number): Promise<void>;
  delete(conversationId: string): Promise<void>;
}

export class InMemoryPlanningContextRepository implements PlanningContextRepository {
  private readonly records = new Map<string, StoredPlanningContext>();

  async create(record: StoredPlanningContext): Promise<void> {
    if (this.records.has(record.conversationId)) {
      throw new ApplicationError('conflict', 'planning context already exists');
    }
    this.records.set(record.conversationId, structuredClone(record));
  }

  async get(conversationId: string): Promise<StoredPlanningContext | undefined> {
    const record = this.records.get(conversationId);
    return record ? structuredClone(record) : undefined;
  }

  async save(record: StoredPlanningContext, expectedVersion: number): Promise<void> {
    const current = this.records.get(record.conversationId);
    if (!current || current.version !== expectedVersion) {
      throw new ApplicationError('conflict', 'planning context version changed');
    }
    this.records.set(record.conversationId, structuredClone(record));
  }

  async delete(conversationId: string): Promise<void> {
    this.records.delete(conversationId);
  }
}

function missingFields(context: Pick<PlanningContext, 'destination' | 'startsAt' | 'endsAt' | 'travelerCount' | 'assumptions'>): PlanningContextField[] {
  const travelerCount = context.travelerCount ?? (context.assumptions.includes('traveler_count_defaulted_to_1') ? 1 : undefined);
  return [
    ...(context.destination ? [] : ['destination' as const]),
    ...(context.startsAt ? [] : ['startsAt' as const]),
    ...(context.endsAt ? [] : ['endsAt' as const]),
    ...(travelerCount ? [] : ['travelerCount' as const]),
  ];
}

function publicContext(record: StoredPlanningContext): PlanningContext {
  const { sessionId: _sessionId, ...context } = record;
  return structuredClone(context);
}

export class PlanningContextService {
  constructor(
    private readonly repository: PlanningContextRepository,
    private readonly conversations: ConversationOwnershipPort,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async initialize(sessionId: string, conversationId: string): Promise<PlanningContext> {
    if (!sessionId || !conversationId) throw new ApplicationError('validation_error');
    await this.conversations.assertOwned(sessionId, conversationId);
    const record: StoredPlanningContext = {
      sessionId,
      conversationId,
      version: 1,
      preferences: [],
      assumptions: [],
      missingFields: ['destination', 'startsAt', 'endsAt', 'travelerCount'],
      updatedAt: this.clock.now().toISOString(),
    };
    try {
      await this.repository.create(record);
      return publicContext(record);
    } catch (error) {
      if ((error instanceof ApplicationError && error.code === 'conflict') || (error instanceof Error && error.name === 'RepositoryConflictError')) {
        return publicContext(this.owned(sessionId, await this.require(conversationId)));
      }
      throw error;
    }
  }

  async get(sessionId: string, conversationId: string): Promise<PlanningContext> {
    await this.conversations.assertOwned(sessionId, conversationId);
    return publicContext(this.owned(sessionId, await this.require(conversationId)));
  }

  async applyPatch(
    sessionId: string,
    conversationId: string,
    patch: PlanningContextPatch,
    expectedVersion: number,
  ): Promise<PlanningContext> {
    await this.conversations.assertOwned(sessionId, conversationId);
    const current = this.owned(sessionId, await this.require(conversationId));
    if (current.version !== expectedVersion) throw new ApplicationError('conflict', 'planning context version changed');
    const parsed = PlanningContextPatchSchema.safeParse(patch);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.message);

    const updated: StoredPlanningContext = {
      ...current,
      ...parsed.data,
      preferences: parsed.data.preferences ? [...new Set(parsed.data.preferences)] : current.preferences,
      assumptions: parsed.data.assumptions ?? current.assumptions,
      version: current.version + 1,
      updatedAt: this.clock.now().toISOString(),
      missingFields: [],
    };
    const draft = this.tripDraft(publicContext(updated));
    if ((updated.startsAt && !updated.startsAt.endsWith('+08:00')) || (updated.endsAt && !updated.endsAt.endsWith('+08:00'))) {
      throw new ApplicationError('validation_error', 'trip timestamps must use China Standard Time');
    }
    if (updated.startsAt && updated.endsAt && Date.parse(updated.startsAt) >= Date.parse(updated.endsAt)) {
      throw new ApplicationError('validation_error', 'trip interval must have a valid start before end');
    }
    if (draft) {
      try {
        validateTrip(draft);
      } catch (error) {
        throw new ApplicationError('validation_error', error instanceof Error ? error.message : 'trip validation failed');
      }
    }
    updated.missingFields = missingFields(updated);
    await this.repository.save(updated, expectedVersion);
    return publicContext(updated);
  }

  tripDraft(context: PlanningContext): TripDraft | undefined {
    const travelerCount = context.travelerCount ?? (context.assumptions.includes('traveler_count_defaulted_to_1') ? 1 : undefined);
    if (!context.destination || !context.startsAt || !context.endsAt || !travelerCount) return undefined;
    return {
      destination: context.destination,
      startsAt: context.startsAt,
      endsAt: context.endsAt,
      travelerCount,
      totalBudgetCents: context.totalBudgetCents ?? 0,
    };
  }

  async delete(sessionId: string, conversationId: string): Promise<void> {
    await this.conversations.assertOwned(sessionId, conversationId);
    this.owned(sessionId, await this.require(conversationId));
    await this.repository.delete(conversationId);
  }

  /** Trusted cleanup hook used after the Conversation ownership check has already run. */
  async purgeConversation(conversationId: string): Promise<void> {
    await this.repository.delete(conversationId);
  }

  private async require(conversationId: string): Promise<StoredPlanningContext> {
    const record = await this.repository.get(conversationId);
    if (!record) throw new ApplicationError('validation_error', 'planning context not found');
    return record;
  }

  private owned(sessionId: string, record: StoredPlanningContext): StoredPlanningContext {
    if (record.sessionId !== sessionId) throw new ApplicationError('forbidden', 'conversation belongs to another session');
    return record;
  }
}
