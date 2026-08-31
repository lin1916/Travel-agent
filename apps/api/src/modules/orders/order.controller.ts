import { Controller, Get, Headers, Param, UnauthorizedException } from '@nestjs/common';
import { OrderQueryService } from '@travel/application';
@Controller('v1/trips')
export class OrderController { constructor(private readonly orders: OrderQueryService) {} @Get(':tripId/orders') list(@Headers('x-actor-id') actorId: string, @Param('tripId') tripId: string) { if (!actorId) throw new UnauthorizedException(); return this.orders.listByTrip(tripId, actorId); } }
