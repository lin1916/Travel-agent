import { randomUUID } from 'node:crypto';
import type {
  EventEnvelope,
  ItineraryItem,
  ItineraryWarning,
  PlanCommand,
  PlanItem,
  PlanItemInput,
  PlanVersion,
  PlanningBudgetSummary,
  RouteEstimator,
  TravelCategory,
} from '@travel/contracts';
import { PlanCommandSchema, PlanItemInputSchema } from '@travel/contracts';
import { buildSoftWarnings, findDirectOverlaps } from '@travel/domain';
import { ApplicationError } from '../errors.js';

export interface PlanContext {
  travelerCount: number;
  totalBudgetCents: number;
}

export interface PlanVersionStore {
  append(version: PlanVersion, ownerId: string): Promise<void>;
  current(tripId: string, ownerId: string): Promise<PlanVersion | undefined>;
  listVersions(tripId: string, ownerId: string): Promise<PlanVersion[]>;
}

export interface PlanServiceOptions {
  now?: () => Date;
  id?: () => string;
  routeEstimator?: RouteEstimator;
  publisher?: PlanEventPublisher;
  store?: PlanVersionStore;
}

export type PlanEvent = Omit<EventEnvelope, 'sequence'> & { tripId?: string };

export interface PlanEventPublisher {
  publish(event: PlanEvent): Promise<void> | void;
}

export class InMemoryPlanEventPublisher implements PlanEventPublisher {
  readonly events: EventEnvelope[] = [];
  private readonly sequences = new Map<string, number>();

  publish(event: PlanEvent): void {
    const aggregateKey = `${event.aggregate_type}:${event.aggregate_id}`;
    const sequence = (this.sequences.get(aggregateKey) ?? 0) + 1;
    this.sequences.set(aggregateKey, sequence);
    this.events.push(clone({ ...event, sequence }));
  }
}

interface PlanState {
  ownerId: string;
  context: PlanContext;
  history: PlanVersion[];
}

const defaultContext: PlanContext = { travelerCount: 1, totalBudgetCents: 0 };
const defaultEstimator: RouteEstimator = { estimate: async () => ({ minutes: 0 }) };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function money(amountCents: number) {
  return { amountCents, currency: 'CNY' as const };
}

function validateContext(input?: PlanContext): PlanContext {
  const context = input ?? defaultContext;
  if (!Number.isInteger(context.travelerCount) || context.travelerCount < 1 || context.travelerCount > 6) {
    throw new ApplicationError('validation_error', 'travelerCount must be an integer between 1 and 6');
  }
  if (!Number.isInteger(context.totalBudgetCents) || context.totalBudgetCents < 0) {
    throw new ApplicationError('validation_error', 'totalBudgetCents must be a non-negative integer');
  }
  return clone(context);
}

function validateInterval(startsAt: string, endsAt: string): void {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new ApplicationError('validation_error', 'plan item must have a valid start before end');
  }
}

function validateCstInterval(startsAt: string, endsAt: string): void {
  if (!startsAt.endsWith('+08:00') || !endsAt.endsWith('+08:00')) {
    throw new ApplicationError('validation_error', 'proposal itinerary timestamps must use China Standard Time');
  }
}

function toItinerary(item: PlanItem): ItineraryItem {
  return {
    id: item.id,
    version: 1,
    tripId: '',
    category: item.category,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    location: item.location,
    offerId: item.offerId,
    confirmed: true,
  };
}

function summaryFor(kind: PlanCommand['kind'], itemIds: string[]): string {
  if (kind === 'add') return 'Added an itinerary item';
  if (kind === 'move') return 'Moved an itinerary item';
  if (kind === 'remove') return 'Removed an itinerary item';
  if (kind === 'replace') return 'Replaced an itinerary item';
  if (kind === 'lock') return 'Updated an itinerary lock';
  if (kind === 'optimize') return 'Optimized a day without changing locked items';
  if (kind === 'check') return 'Checked schedule timing';
  if (kind === 'calculate') return 'Recalculated estimated budget';
  return `${kind}: ${itemIds.join(', ')}`;
}

export class PlanService {
  private readonly plans = new Map<string, PlanState>();
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly routeEstimator: RouteEstimator;
  private readonly publisher?: PlanEventPublisher;
  private readonly store?: PlanVersionStore;

  constructor(options: PlanServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => randomUUID());
    this.routeEstimator = options.routeEstimator ?? defaultEstimator;
    this.publisher = options.publisher;
    this.store = options.store;
  }

  async current(tripId: string, ownerId: string, context?: PlanContext): Promise<PlanVersion> {
    if (!tripId || !ownerId) throw new ApplicationError('validation_error', 'trip and owner are required');
    const existing = await this.loadState(tripId, ownerId, context);
    if (existing) {
      if (context) existing.context = validateContext(context);
      return clone(existing.history.at(-1)!);
    }
    const normalized = validateContext(context);
    const initial: PlanVersion = {
      id: this.id(),
      tripId,
      version: 1,
      createdAt: this.now().toISOString(),
      items: [],
      warnings: [],
      budget: this.calculateBudget([], normalized),
      changeSet: { command: 'calculate', summary: 'Initialized an empty itinerary plan', changedItemIds: [] },
    };
    await this.store?.append(initial, ownerId);
    this.plans.set(tripId, { ownerId, context: normalized, history: [initial] });
    await this.publishVersion(initial);
    return clone(initial);
  }

  async lookupCurrent(tripId: string, ownerId: string, context?: PlanContext): Promise<PlanVersion | undefined> {
    const state = await this.loadState(tripId, ownerId, context);
    return state ? clone(state.history.at(-1)!) : undefined;
  }

  async currentAccepted(tripId: string, ownerId: string, context?: PlanContext): Promise<{ plan?: PlanVersion; currentVersion: number }> {
    const current = await this.current(tripId, ownerId, context);
    const state = this.plans.get(tripId)!;
    const accepted = state.history.some(version => version.changeSet.command === 'accept_proposal');
    return { ...(accepted ? { plan: clone(current) } : {}), currentVersion: current.version };
  }

  async execute(tripId: string, ownerId: string, rawCommand: PlanCommand, expectedVersion: number, context?: PlanContext): Promise<PlanVersion> {
    const state = await this.stateFor(tripId, ownerId, context);
    const commandResult = PlanCommandSchema.safeParse(rawCommand);
    if (!commandResult.success) throw new ApplicationError('validation_error', commandResult.error.issues[0]?.message ?? 'invalid plan command');
    const command = commandResult.data;
    const current = state.history.at(-1)!;
    if (current.version !== expectedVersion) throw new ApplicationError('conflict', 'plan version changed');

    let items = clone(current.items);
    const changedItemIds: string[] = [];
    switch (command.kind) {
      case 'add': {
        const parsed = PlanItemInputSchema.parse(command.item);
        const next = this.newItem(parsed);
        this.assertNoOverlap(items, next);
        items.push(next);
        changedItemIds.push(next.id);
        break;
      }
      case 'move': {
        const index = this.indexOf(items, command.itemId);
        const currentItem = items[index];
        this.assertMutable(currentItem);
        validateInterval(command.startsAt, command.endsAt);
        const next = { ...currentItem, startsAt: command.startsAt, endsAt: command.endsAt, ...(command.location ? { location: command.location } : {}) };
        this.assertNoOverlap(items, next);
        items[index] = next;
        changedItemIds.push(next.id);
        break;
      }
      case 'remove': {
        const index = this.indexOf(items, command.itemId);
        this.assertMutable(items[index]);
        items.splice(index, 1);
        changedItemIds.push(command.itemId);
        break;
      }
      case 'replace': {
        const index = this.indexOf(items, command.itemId);
        const currentItem = items[index];
        this.assertMutable(currentItem);
        const parsed = PlanItemInputSchema.parse(command.item);
        const next = { ...this.newItem(parsed), id: currentItem.id, locked: false };
        this.assertNoOverlap(items, next);
        items[index] = next;
        changedItemIds.push(next.id);
        break;
      }
      case 'lock': {
        const index = this.indexOf(items, command.itemId);
        items[index] = { ...items[index], locked: command.locked };
        changedItemIds.push(command.itemId);
        break;
      }
      case 'optimize': {
        const dayItems = items.filter(item => item.startsAt.slice(0, 10) === command.day).sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
        let cursor = 0;
        items = items.map(item => item.startsAt.slice(0, 10) === command.day ? dayItems[cursor++] : item);
        changedItemIds.push(...dayItems.map(item => item.id));
        break;
      }
      case 'check':
      case 'calculate':
        break;
    }

    return this.append(state, items, command.kind, changedItemIds);
  }

  async undo(tripId: string, ownerId: string, expectedVersion: number, context?: PlanContext): Promise<PlanVersion> {
    const state = await this.stateFor(tripId, ownerId, context);
    const current = state.history.at(-1)!;
    if (current.version !== expectedVersion) throw new ApplicationError('conflict', 'plan version changed');
    if (state.history.length < 2) throw new ApplicationError('validation_error', 'there is no preceding plan version to undo');
    const previous = state.history.at(-2)!;
    return this.append(state, previous.items, 'undo', previous.items.map(item => item.id), previous.warnings, previous.budget);
  }

  async acceptProposal(tripId: string, ownerId: string, items: PlanItemInput[], expectedVersion: number, context?: PlanContext): Promise<PlanVersion> {
    const { state, version } = await this.prepareProposal(tripId, ownerId, items, expectedVersion, context);
    await this.persistAndPublish(version, ownerId);
    state.history.push(version);
    return clone(version);
  }

  async prepareProposalVersion(tripId: string, ownerId: string, items: PlanItemInput[], expectedVersion: number, context?: PlanContext): Promise<PlanVersion> {
    return clone((await this.prepareProposal(tripId, ownerId, items, expectedVersion, context)).version);
  }

  async adoptPersistedVersion(version: PlanVersion, ownerId: string, context?: PlanContext): Promise<void> {
    const state = await this.loadState(version.tripId, ownerId, context);
    if (!state) {
      this.plans.set(version.tripId, { ownerId, context: validateContext(context), history: [clone(version)] });
      return;
    }
    this.assertOwner(state, ownerId);
    if (!state.history.some(item => item.id === version.id)) state.history.push(clone(version));
  }

  snapshot(): unknown {
    return clone([...this.plans.entries()]);
  }

  restore(snapshot: unknown): void {
    this.plans.clear();
    for (const [tripId, state] of snapshot as Array<[string, PlanState]>) this.plans.set(tripId, clone(state));
  }

  private async stateFor(tripId: string, ownerId: string, context?: PlanContext): Promise<PlanState> {
    const existing = await this.loadState(tripId, ownerId, context);
    if (!existing) {
      await this.current(tripId, ownerId, context);
      return this.plans.get(tripId)!;
    }
    if (context) existing.context = validateContext(context);
    return existing;
  }

  private async loadState(tripId: string, ownerId: string, context?: PlanContext): Promise<PlanState | undefined> {
    const cached = this.plans.get(tripId);
    if (cached) {
      this.assertOwner(cached, ownerId);
      return cached;
    }
    if (!this.store) return undefined;
    const current = await this.store.current(tripId, ownerId);
    if (!current) return undefined;
    const history = await this.store.listVersions(tripId, ownerId);
    const state = { ownerId, context: validateContext(context), history: history.length ? history : [current] };
    this.plans.set(tripId, state);
    return state;
  }

  private async prepareProposal(tripId: string, ownerId: string, items: PlanItemInput[], expectedVersion: number, context?: PlanContext): Promise<{ state: PlanState; version: PlanVersion }> {
    const state = await this.stateFor(tripId, ownerId, context);
    const current = state.history.at(-1)!;
    if (current.version !== expectedVersion) throw new ApplicationError('conflict', 'plan version changed');
    const next = items.map(item => {
      const parsed = PlanItemInputSchema.safeParse(item);
      if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid proposal itinerary item');
      validateCstInterval(parsed.data.startsAt, parsed.data.endsAt);
      return this.newItem(parsed.data);
    });
    for (const item of next) this.assertNoOverlap(next, item);
    return { state, version: await this.buildVersion(state, next, 'accept_proposal', next.map(item => item.id)) };
  }

  private async append(state: PlanState, items: PlanItem[], command: PlanCommand['kind'] | 'undo' | 'accept_proposal', changedItemIds: string[], warnings?: ItineraryWarning[], budget?: PlanningBudgetSummary): Promise<PlanVersion> {
    const next = await this.buildVersion(state, items, command, changedItemIds, warnings, budget);
    await this.persistAndPublish(next, state.ownerId);
    state.history.push(next);
    return clone(next);
  }

  private async buildVersion(state: PlanState, items: PlanItem[], command: PlanCommand['kind'] | 'undo' | 'accept_proposal', changedItemIds: string[], warnings?: ItineraryWarning[], budget?: PlanningBudgetSummary): Promise<PlanVersion> {
    const current = state.history.at(-1)!;
    return {
      id: this.id(),
      tripId: current.tripId,
      version: current.version + 1,
      createdAt: this.now().toISOString(),
      items: clone(items),
      warnings: clone(warnings ?? await buildSoftWarnings(items.map(toItinerary), this.routeEstimator)),
      budget: clone(budget ?? this.calculateBudget(items, state.context)),
      changeSet: {
        command,
        summary: command === 'undo' ? `undo version ${current.version}` : command === 'accept_proposal' ? 'Accepted a proposed itinerary' : summaryFor(command, changedItemIds),
        changedItemIds: [...changedItemIds],
      },
    };
  }

  private async persistAndPublish(version: PlanVersion, ownerId: string): Promise<void> {
    await this.store?.append(version, ownerId);
    await this.publishVersion(version);
  }

  private async publishVersion(version: PlanVersion): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.publish({
      event_id: version.id,
      event_type: 'PlanVersionCreated',
      aggregate_type: 'Trip',
      aggregate_id: version.tripId,
      schema_version: 1,
      occurred_at: version.createdAt,
      request_id: version.id,
      correlation_id: version.tripId,
      redacted_payload: {
        version: version.version,
        command: version.changeSet.command,
        changedItemIds: [...version.changeSet.changedItemIds],
        warningCodes: version.warnings.map(warning => warning.code),
        budgetWarnings: [...version.budget.warnings],
        estimatedTotalCents: version.budget.estimatedTotal.amountCents,
      },
      tripId: version.tripId,
    });
  }

  private calculateBudget(items: PlanItem[], context: PlanContext): PlanningBudgetSummary {
    const totals: Partial<Record<TravelCategory, number>> = {};
    let groupTotalCents = 0;
    for (const item of items) {
      const amount = item.estimatedCostCents * (item.priceScope === 'per_person' ? context.travelerCount : 1);
      totals[item.category] = (totals[item.category] ?? 0) + amount;
      groupTotalCents += amount;
    }
    const limit = context.totalBudgetCents;
    const warnings: PlanningBudgetSummary['warnings'] = [];
    if (limit === 0 ? groupTotalCents > 0 : groupTotalCents * 100 >= limit * 80) warnings.push('budget_80_percent');
    if (groupTotalCents > limit) warnings.push('budget_exceeded');
    return {
      limit: money(limit),
      estimatedTotal: money(groupTotalCents),
      groupTotal: money(groupTotalCents),
      perPerson: money(Math.round(groupTotalCents / context.travelerCount)),
      byCategory: Object.fromEntries(Object.entries(totals).map(([category, amount]) => [category, money(amount ?? 0)])),
      utilizationPercent: limit === 0 ? (groupTotalCents > 0 ? 100 : 0) : (groupTotalCents / limit) * 100,
      warnings,
    };
  }

  private newItem(input: PlanItemInput): PlanItem {
    validateInterval(input.startsAt, input.endsAt);
    return { ...input, id: this.id(), locked: false } as PlanItem;
  }

  private indexOf(items: PlanItem[], id: string): number {
    const index = items.findIndex(item => item.id === id);
    if (index < 0) throw new ApplicationError('validation_error', 'plan item not found');
    return index;
  }

  private assertMutable(item: PlanItem | undefined): asserts item is PlanItem {
    if (!item) throw new ApplicationError('validation_error', 'plan item not found');
    if (item.locked) throw new ApplicationError('policy_blocked', 'locked itinerary items cannot be changed automatically');
  }

  private assertNoOverlap(items: PlanItem[], candidate: PlanItem): void {
    try {
      const conflicts = findDirectOverlaps(items.map(toItinerary), toItinerary(candidate));
      if (conflicts.length > 0) throw new ApplicationError('conflict', 'plan item directly overlaps another itinerary item');
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError('validation_error', error instanceof Error ? error.message : 'invalid plan interval');
    }
  }

  private assertOwner(state: PlanState, ownerId: string): void {
    if (state.ownerId !== ownerId) throw new ApplicationError('forbidden', 'plan belongs to another actor');
  }
}
