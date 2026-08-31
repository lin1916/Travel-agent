import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import { BookingServiceImpl } from '@travel/application';
import { ApplicationError } from '@travel/application';
import { z } from 'zod';
import { isOpaqueReference } from '@travel/security';
import { OfferKindSchema } from '@travel/contracts';

const CreateSchema = z.object({ id: z.string().min(1), offerId: z.string().min(1), offerKind: OfferKindSchema, supplierId: z.string().min(1), selectedOfferSnapshotHash: z.string().min(1), originalPriceCents: z.number().int().nonnegative(), refundRulesHash: z.string().min(1), travelerDataGrantId: z.string().min(1), travelerDataGrantExpiresAt: z.string().datetime({ offset: true }).optional(), travelerIds: z.array(z.string().min(1)).min(1).max(6).refine(values => values.every(isOpaqueReference), 'traveler references must be provider-issued opaque values').optional(), requestedSensitiveFields: z.array(z.string().min(1)).min(1).optional(), travelerDataPurpose: z.string().min(1).optional(), supplierLegalEntity: z.string().min(1).optional(), refundable: z.boolean().optional(), startsAt: z.string().datetime({ offset: true }).optional(), endsAt: z.string().datetime({ offset: true }).optional() }).strict();
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
  async commit(@Headers('x-actor-id') actorId: string, @Headers('x-request-id') requestId: string | undefined, @Headers('x-correlation-id') correlationId: string | undefined, @Param('intentId') intentId: string, @Body() body: any) {
    if (!actorId) throw new ApplicationError('unauthorized');
    const parsed = CommitSchema.safeParse(body);
    if (!parsed.success) throw new ApplicationError('validation_error', parsed.error.issues[0]?.message);
    return this.service.commit(actorId, { ...parsed.data, intentId, requestId, correlationId });
  }

  @Get('booking-intents/:intentId')
  async get(@Headers('x-actor-id') actorId: string, @Param('intentId') intentId: string) { if (!actorId) throw new ApplicationError('unauthorized'); return this.service.get(intentId, actorId); }

  @Get('supplier-orders/:orderId')
  async order(@Headers('x-actor-id') actorId: string, @Param('orderId') orderId: string) { if (!actorId) throw new ApplicationError('unauthorized'); return this.service.getSupplierOrder(orderId, actorId); }

  @Get('supplier-redirects/:supplierId')
  async redirect(@Headers('x-actor-id') actorId: string, @Param('supplierId') supplierId: string, @Query('token') token?: string) {
    if (!actorId) throw new ApplicationError('unauthorized');
    if (!token) throw new ApplicationError('validation_error', 'redirect token is required');
    return this.service.resolveRedirect(actorId, supplierId, token);
  }
}
