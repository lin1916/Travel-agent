import type { Kysely } from 'kysely';
import { BudgetRepository, EventRepository, IdempotencyRepository, ItineraryRepository, TripRepository, type Database } from '@travel/persistence';
import { BudgetService, InMemoryTripStore, ItineraryService, PersistentBudgetService, PersistentItineraryService, PersistentTripStore, TripService } from '@travel/application';
import { API_DATABASE } from '../../database.module.js';

export const TRIP_SERVICE = Symbol('TRIP_SERVICE');
export const ITINERARY_SERVICE = Symbol('ITINERARY_SERVICE');
export const BUDGET_SERVICE = Symbol('BUDGET_SERVICE');

const routeEstimator = { estimate: async () => ({ minutes: 0 }) };

export const tripProviders = [
  {
    provide: TRIP_SERVICE,
    inject: [API_DATABASE],
    useFactory: (db: Kysely<Database> | undefined) => {
      if (!db) return new TripService(new InMemoryTripStore());
      return new TripService(new PersistentTripStore(db, new TripRepository(db), new BudgetRepository(db), new IdempotencyRepository(db), new EventRepository(db)));
    },
  },
  {
    provide: ITINERARY_SERVICE,
    inject: [API_DATABASE],
    useFactory: (db: Kysely<Database> | undefined) => {
      if (!db) return new ItineraryService();
      return new PersistentItineraryService(new ItineraryRepository(db), routeEstimator);
    },
  },
  {
    provide: BUDGET_SERVICE,
    inject: [API_DATABASE],
    useFactory: (db: Kysely<Database> | undefined) => {
      if (!db) return new BudgetService();
      return new PersistentBudgetService(new BudgetRepository(db));
    },
  },
];
