import {
  CoordinateSchema,
  PlaceSchema,
  RoutePlanSchema,
  RouteRequestSchema,
  type MapProvider,
  type Place,
  type RoutePlan,
  type RouteRequest,
} from '@travel/contracts';
import { ApplicationError } from '../errors.js';

export class MapService {
  constructor(private readonly provider: MapProvider) {}

  async searchPlaces(query: string): Promise<Place[]> {
    if (!query.trim()) throw new ApplicationError('validation_error', 'place query is required');
    return this.call('search places', () => this.provider.searchPlaces(query))
      .then(value => value.map(place => PlaceSchema.parse(place)));
  }

  async geocode(address: string) {
    if (!address.trim()) throw new ApplicationError('validation_error', 'address is required');
    return this.call('geocode address', () => this.provider.geocode(address))
      .then(value => CoordinateSchema.parse(value));
  }

  async planRoute(request: RouteRequest): Promise<RoutePlan> {
    const parsed = RouteRequestSchema.safeParse(request);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid route request');
    return this.call('plan route', () => this.provider.planRoute(parsed.data))
      .then(value => RoutePlanSchema.parse(value));
  }

  private async call<T>(operation: string, callback: () => Promise<T>): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      const detail = error instanceof Error ? error.message : 'unknown provider failure';
      throw new ApplicationError('supplier_unavailable', `${operation}: ${detail}`);
    }
  }
}
