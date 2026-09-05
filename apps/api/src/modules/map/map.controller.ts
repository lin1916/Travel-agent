import { All, Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApplicationError, ConversationService, MapService, PlanningContextService } from '@travel/application';
import { RouteRequestSchema } from '@travel/contracts';
import { AnonymousSessionGuard } from '../conversations/anonymous-session.js';
import { TRIP_SERVICE } from '../trips/trip.providers.js';
import { AMapJsProxy } from './amap-client.js';

@Controller('v1/trips/:tripId')
export class MapController {
  constructor(
    @Inject(MapService) private readonly mapService: MapService,
    @Inject(TRIP_SERVICE) private readonly tripService: { get(id: string, ownerId: string): Promise<unknown> },
  ) {}

  @Get('places')
  async places(@Headers('x-actor-id') actor: string | undefined, @Param('tripId') tripId: string, @Query('query') query: string | undefined) {
    if (!actor) throw new ApplicationError('unauthorized', 'x-actor-id header is required');
    await this.tripService.get(tripId, actor);
    if (!query) throw new ApplicationError('validation_error', 'query is required');
    return { places: await this.mapService.searchPlaces(query) };
  }

  @Post('routes')
  async route(@Headers('x-actor-id') actor: string | undefined, @Param('tripId') tripId: string, @Body() body: unknown) {
    if (!actor) throw new ApplicationError('unauthorized', 'x-actor-id header is required');
    await this.tripService.get(tripId, actor);
    const parsed = RouteRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid route request');
    return this.mapService.planRoute(parsed.data);
  }
}

interface SessionRequest { anonymousSessionId?: string }

function hasExplicitCity(query: string, destination: string): boolean {
  return query.includes(destination) || /(?:省|市|自治区|特别行政区|北京|上海|天津|重庆|香港|澳门)/u.test(query);
}

@Controller('v1/conversations/:conversationId')
@UseGuards(AnonymousSessionGuard)
export class ConversationMapController {
  constructor(
    @Inject(MapService) private readonly mapService: MapService,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(PlanningContextService) private readonly planningContexts: PlanningContextService,
  ) {}

  @Get('places/search')
  async places(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Query('query') query: string | undefined) {
    const sessionId = this.session(request);
    await this.conversations.get(sessionId, conversationId);
    if (!query?.trim()) throw new ApplicationError('validation_error', 'query is required');
    const context = await this.planningContexts.get(sessionId, conversationId);
    const normalizedQuery = context.destination && !hasExplicitCity(query, context.destination)
      ? `${query.trim()} ${context.destination}`
      : query.trim();
    return { places: await this.mapService.searchPlaces(normalizedQuery) };
  }

  @Post('routes')
  async route(@Req() request: SessionRequest, @Param('conversationId') conversationId: string, @Body() body: unknown) {
    const sessionId = this.session(request);
    await this.conversations.get(sessionId, conversationId);
    const parsed = RouteRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid route request');
    return this.mapService.planRoute(parsed.data);
  }

  private session(request: SessionRequest): string {
    if (!request.anonymousSessionId) throw new ApplicationError('unauthorized');
    return request.anonymousSessionId;
  }
}

@Controller()
export class MapPublicController {
  constructor(@Inject(AMapJsProxy) private readonly jsProxy: AMapJsProxy) {}

  @Get('v1/map/public-config')
  publicConfig() {
    return { jsKey: process.env.AMAP_JS_KEY ?? '', proxyUrl: '/_AMapService' };
  }

  @All('_AMapService/*')
  async proxy(@Req() request: { url: string }, @Res() response: { status(code: number): { send(body: unknown): void } }) {
    const parsed = new URL(request.url, 'http://localhost');
    const upstream = await this.jsProxy.forward(parsed.pathname.replace('/_AMapService', ''), Object.fromEntries(parsed.searchParams.entries()));
    response.status(upstream.status).send(await upstream.json());
  }
}
