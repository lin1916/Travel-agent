import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { BookingServiceImpl } from '@travel/application';
import { ApplicationError } from '@travel/application';
import { z } from 'zod';
import { OfferKindSchema } from '@travel/contracts';

const CreateSchema = z.object({ id: z.string().min(1), offerId: z.string().min(1), offerKind: OfferKindSchema, supplierId: z.string().min(1), selectedOfferSnapshotHash: z.string().min(1), originalPriceCents: z.number().int().nonnegative(), refundRulesHash: z.string().min(1), travelerDataGrantId: z.string().min(1) }).strict();
const CommitSchema = z.object({ expectedVersion: z.number().int().positive(), actionRequestId: z.string().min(1).optional(), mandateId: z.string().min(1).optional(), idempotencyKey: z.string().min(1), selectedOfferSnapshotHash: z.string().min(1) }).strict();

@Controller('v1')
export class BookingController {
  constructor(@Inject(BookingServiceImpl) private readonly service: BookingServiceImpl) {}

  @Post('trips/:tripId/booking-intents')
  @HttpCode(HttpStatus.CREATED)
  async create(@Headers('x-actor-id') actorId: string, @Param('tripId') tripId: string, @Body() body: any) {
    if (!actorId) throw new ApplicationError('unauthorized');
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message);
    return this.service.create(actorId, { ...parsed.data, tripId, offerKind: parsed.data.offerKind as any });
  }

  @Post('booking-intents/:intentId/commit')
  @HttpCode(HttpStatus.ACCEPTED)
  async commit(@Headers('x-actor-id') actorId: string, @Param('intentId') intentId: string, @Body() body: any) {
    if (!actorId) throw new ApplicationError('unauthorized');
    const parsed = CommitSchema.safeParse(body);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message);
    return this.service.commit(actorId, { ...parsed.data, intentId });
  }

  @Get('booking-intents/:intentId')
  async get(@Headers('x-actor-id') actorId: string, @Param('intentId') intentId: string) { return this.service.get(intentId, actorId); }

  @Get('supplier-orders/:orderId')
  async order(@Headers('x-actor-id') actorId: string, @Param('orderId') orderId: string) { if (!actorId) throw new ApplicationError('unauthorized'); return this.service.getSupplierOrder(orderId, actorId); }
}
