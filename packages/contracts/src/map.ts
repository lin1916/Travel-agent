import { z } from 'zod';

export const CoordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  coordinateSystem: z.literal('GCJ-02').default('GCJ-02'),
}).strict();
export type Coordinate = z.infer<typeof CoordinateSchema>;

export const PlaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  location: CoordinateSchema,
  coordinateSystem: z.literal('gcj02'),
  provider: z.literal('amap'),
  providerPlaceId: z.string().min(1),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
}).strict();
export type Place = z.infer<typeof PlaceSchema>;

export const RouteModeSchema = z.enum(['walk', 'transit', 'drive']);
export type RouteMode = z.infer<typeof RouteModeSchema>;

const RouteBaseSchema = z.object({
  originPlaceId: z.string().min(1),
  destinationPlaceId: z.string().min(1),
  mode: RouteModeSchema,
  origin: CoordinateSchema,
  destination: CoordinateSchema,
  provider: z.literal('amap'),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export const AvailableRoutePlanSchema = RouteBaseSchema.extend({
  status: z.literal('available'),
  distanceMeters: z.number().finite().nonnegative(),
  durationMinutes: z.number().finite().nonnegative(),
  polyline: z.string().nullable(),
  estimatedCostCents: z.number().int().nonnegative().nullable(),
}).strict();
export const UnavailableRoutePlanSchema = RouteBaseSchema.extend({
  status: z.literal('unavailable'),
  reason: z.string().min(1),
}).strict();
export const RoutePlanSchema = z.discriminatedUnion('status', [
  AvailableRoutePlanSchema,
  UnavailableRoutePlanSchema,
]);
export type RoutePlan = z.infer<typeof RoutePlanSchema>;

export const RouteRequestSchema = z.object({
  originPlaceId: z.string().min(1).optional(),
  destinationPlaceId: z.string().min(1).optional(),
  mode: RouteModeSchema,
  origin: CoordinateSchema,
  destination: CoordinateSchema,
}).strict();
export type RouteRequest = z.infer<typeof RouteRequestSchema>;

export interface MapProvider {
  searchPlaces(query: string): Promise<Place[]>;
  geocode(address: string): Promise<Coordinate>;
  planRoute(request: RouteRequest): Promise<RoutePlan>;
}
