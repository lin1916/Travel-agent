import { createDatabase, BudgetRepository, EventRepository, IdempotencyRepository, ItineraryRepository, TripRepository } from '@travel/persistence';
import { BudgetService, InMemoryTripStore, ItineraryService, PersistentBudgetService, PersistentItineraryService, PersistentTripStore, TripService } from '@travel/application';

export const TRIP_SERVICE = Symbol('TRIP_SERVICE');
export const ITINERARY_SERVICE = Symbol('ITINERARY_SERVICE');
export const BUDGET_SERVICE = Symbol('BUDGET_SERVICE');

const routeEstimator = { estimate: async () => ({ minutes: 0 }) };

export const tripProviders = [
  {
    provide: TRIP_SERVICE,
    useFactory: () => {
      if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'test') return new TripService(new InMemoryTripStore());
      const db = createDatabase();
      return new TripService(new PersistentTripStore(db, new TripRepository(db), new BudgetRepository(db), new IdempotencyRepository(db), new EventRepository(db)));
    },
  },
  {
    provide: ITINERARY_SERVICE,
    useFactory: () => {
      if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'test') return new ItineraryService();
      const db = createDatabase();
      return new PersistentItineraryService(new ItineraryRepository(db), routeEstimator);
    },
  },
  {
    provide: BUDGET_SERVICE,
    useFactory: () => {
      if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'test') return new BudgetService();
      const db = createDatabase();
      return new PersistentBudgetService(new BudgetRepository(db));
    },
  },
];
