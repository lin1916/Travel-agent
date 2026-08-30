import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { BookingServiceImpl } from '@travel/application';
import { ApplicationError } from '@travel/application';

@Controller('v1')
export class BookingController {
  constructor(private readonly service: BookingServiceImpl) {}

  @Post('trips/:tripId/booking-intents')
  @HttpCode(HttpStatus.CREATED)
  async create(@Headers('x-actor-id') actorId: string, @Param('tripId') tripId: string, @Body() body: any) {
    if (!actorId) throw new ApplicationError('unauthorized');
    return this.service.create(actorId, { ...body, tripId });
  }

  @Post('booking-intents/:intentId/commit')
  @HttpCode(HttpStatus.ACCEPTED)
  async commit(@Headers('x-actor-id') actorId: string, @Param('intentId') intentId: string, @Body() body: any) {
    if (!actorId) throw new ApplicationError('unauthorized');
    return this.service.commit(actorId, { ...body, intentId });
  }

  @Get('booking-intents/:intentId')
  async get(@Headers('x-actor-id') actorId: string, @Param('intentId') intentId: string) { return this.service.get(intentId, actorId); }
}
