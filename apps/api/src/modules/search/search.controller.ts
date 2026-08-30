import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApplicationError, type SearchService as SearchApplicationService } from '@travel/application';
import { SearchRequestSchema, type OfferKind, type SearchRequest } from '@travel/contracts';
import { SEARCH_SERVICE } from './search.tokens.js';
import { TRIP_SERVICE } from '../trips/trip.providers.js';

interface SearchBody { kinds?: OfferKind[]; origin?: string; startsAt?: string; endsAt?: string; travelers?: number; mode?: 'value' | 'cheapest' | 'fastest' | 'comfortable'; budgetLimit?: { amountCents: number; currency: 'CNY' } }

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
  async search(@Headers('x-actor-id') actor: string | undefined, @Param('tripId') tripId: string, @Body() body: SearchBody) {
    const trip = await this.tripService.get(tripId, actorId(actor));
    const kinds = body.kinds?.length ? body.kinds : ['train', 'stay', 'attraction', 'dining'] as OfferKind[];
    const travelers = body.travelers ?? trip.travelerCount;
    const requests: SearchRequest[] = kinds.map(kind => {
      const candidate = { tripId, kind, origin: body.origin, destination: trip.destination, startsAt: body.startsAt ?? trip.startsAt, endsAt: body.endsAt ?? trip.endsAt, travelers, budgetLimit: body.budgetLimit };
      const parsed = SearchRequestSchema.safeParse(candidate);
      if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message ?? 'invalid search request');
      return parsed.data;
    });
    return this.searchService.search({ requests, mode: body.mode });
  }
}
