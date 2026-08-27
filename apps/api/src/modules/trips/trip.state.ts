import { BudgetService, InMemoryTripStore, ItineraryService, TripService } from '@travel/application';

export const tripService = new TripService(new InMemoryTripStore());
export const itineraryService = new ItineraryService();
export const budgetService = new BudgetService();
