import { Module } from '@nestjs/common';
import type { Kysely } from 'kysely';
import {
  InMemoryPlanEventPublisher,
  PlanService,
  type PlanContext,
  type PlanEvent,
  type PlanEventPublisher,
} from '@travel/application';
import type { PlanContextProvider } from '@travel/agent-runtime';
import { EventRepository, PlanRepository, type Database } from '@travel/persistence';
import { API_DATABASE, DatabaseModule } from '../../database.module.js';
import { TripModule } from '../trips/trip.module.js';
import { PlanController } from './plan.controller.js';

export const PLAN_EVENT_PUBLISHER = Symbol('PLAN_EVENT_PUBLISHER');

export function createPlanContextProvider(
  trips: { getAny(id: string): Promise<{ travelerCount: number } | null> },
  budgets: { get(tripId: string): Promise<{ totalLimit?: { amountCents: number } }> | { totalLimit?: { amountCents: number } } },
): PlanContextProvider {
  return async (tripId: string, _ownerId: string): Promise<PlanContext | undefined> => {
    try {
      const trip = await trips.getAny(tripId);
      if (!trip) return undefined;
      const budget = await budgets.get(tripId);
      return { travelerCount: trip.travelerCount, totalBudgetCents: budget.totalLimit?.amountCents ?? 0 };
    } catch {
      return undefined;
    }
  };
}

export class PostgresPlanEventPublisher implements PlanEventPublisher {
  constructor(private readonly events: Pick<EventRepository, 'append'>) {}

  async publish(event: PlanEvent): Promise<void> {
    await this.events.append(event);
  }
}

@Module({
  imports: [DatabaseModule, TripModule],
  controllers: [PlanController],
  providers: [
    {
      provide: PLAN_EVENT_PUBLISHER,
      inject: [API_DATABASE],
      useFactory: (db: Kysely<Database> | undefined): PlanEventPublisher => {
        return db ? new PostgresPlanEventPublisher(new EventRepository(db)) : new InMemoryPlanEventPublisher();
      },
    },
    {
      provide: PlanService,
      inject: [PLAN_EVENT_PUBLISHER, API_DATABASE],
      useFactory: (publisher: PlanEventPublisher, db: Kysely<Database> | undefined) => new PlanService({
        publisher,
        store: db ? new PlanRepository(db) : undefined,
      }),
    },
  ],
  exports: [PlanService, PLAN_EVENT_PUBLISHER],
})
export class PlanModule {}
