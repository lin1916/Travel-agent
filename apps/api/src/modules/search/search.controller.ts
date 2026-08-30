import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Param, Post, Res } from '@nestjs/common';
import { ApplicationError, type SearchService as SearchApplicationService } from '@travel/application';
import { MoneySchema, OfferKindSchema, SearchRequestSchema, type OfferKind, type SearchRequest } from '@travel/contracts';
import { SEARCH_SERVICE } from './search.tokens.js';
import { TRIP_SERVICE } from '../trips/trip.providers.js';
import { z } from 'zod';

const SearchBodySchema = z.object({
  kinds: z.array(OfferKindSchema).min(1).optional(),
  origin: z.string().min(1).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  travelers: z.number().int().min(1).max(6).optional(),
  mode: z.enum(['value', 'cheapest', 'fastest', 'comfortable']).optional(),
  budgetLimit: MoneySchema.optional(),
}).strict();

function actorId(value: string | undefined): string {
  if (!value) throw new ApplicationError('unauthorized', 'x-actor-id header is required');
  return value;
}

@Controller('v1/trips/:tripId/searches')
export class SearchController {
  constructor(
    @Inject(SEARCH_SERVICE) private readonly searchService: SearchApplicationService,
    @Inject(TRIP_SERVICE) private readonly tripService: { get(id: string, ownerId: string): Promise<{ destination: string; startsAt: string; endsAt: string; travelerCount: number }> },
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async search(@Headers('x-actor-id') actor: string | undefined, @Param('tripId') tripId: string, @Body() rawBody: unknown, @Res({ passthrough: true }) response: { statusCode: number }) {
    const bodyResult = SearchBodySchema.safeParse(rawBody);
    if (!bodyResult.success) throw new ApplicationError('validation_error', bodyResult.error.issues[0]?.message ?? 'invalid search request');
    const body = bodyResult.data;
    const trip = await this.tripService.get(tripId, actorId(actor));
    const kinds = body.kinds?.length ? body.kinds : ['train', 'stay', 'attraction', 'dining'] as OfferKind[];
    const travelers = body.travelers ?? trip.travelerCount;
    const requests: SearchRequest[] = kinds.map(kind => {
      const candidate = { tripId, kind, origin: body.origin, destination: trip.destination, startsAt: body.startsAt ?? trip.startsAt, endsAt: body.endsAt ?? trip.endsAt, travelers, budgetLimit: body.budgetLimit };
      const parsed = SearchRequestSchema.safeParse(candidate);
      if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid search request');
      return parsed.data;
    });
    const result = await this.searchService.search({ requests, mode: body.mode });
    if (result.status === 'queued') response.statusCode = HttpStatus.ACCEPTED;
    return result;
  }
}
