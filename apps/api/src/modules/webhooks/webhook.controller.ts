import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Headers, HttpCode, Inject, Optional, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { SupplierOrderUpdateSchema, type SupplierOrderRef } from '@travel/contracts';
import type { SupplierAdapter } from '@travel/supplier-adapters';
import { travelMetrics } from '@travel/observability';
import { ReplayGuard } from '@travel/security';
import { WEBHOOK_VERIFIER, type WebhookVerifier } from './webhook-verifier.js';

export const WEBHOOK_INTAKE = Symbol('WEBHOOK_INTAKE');
export const SUPPLIER_ADAPTER_REGISTRY = Symbol('SUPPLIER_ADAPTER_REGISTRY');
export const WEBHOOK_REPLAY_GUARD = Symbol('WEBHOOK_REPLAY_GUARD');

export interface WebhookAcceptance {
  supplierId: string;
  externalEventId: string;
  orderRef: SupplierOrderRef;
  payloadHash: string;
  taskId: string;
  taskPayload: Record<string, unknown>;
  requestId?: string;
  correlationId?: string;
}

export interface WebhookIntake {
  resolveOrderId?(orderRef: SupplierOrderRef): Promise<string | null>;
  accept(input: WebhookAcceptance): Promise<boolean>;
}

export interface SupplierAdapterRegistry {
  get(supplierId: string): Pick<SupplierAdapter, 'parseWebhook'> | undefined;
}

interface RawWebhookRequest {
  rawBody?: Buffer;
  requestId?: string;
  correlationId?: string;
}

@Controller('/v1/webhooks/suppliers')
export class WebhookController {
  constructor(
    @Inject(WEBHOOK_VERIFIER) private readonly verifier: WebhookVerifier,
    @Inject(WEBHOOK_INTAKE) private readonly intake: WebhookIntake,
    @Inject(SUPPLIER_ADAPTER_REGISTRY) private readonly adapters: SupplierAdapterRegistry,
    @Optional() @Inject(WEBHOOK_REPLAY_GUARD) private readonly replayGuard?: ReplayGuard,
  ) {}

  @Post(':supplierId')
  @HttpCode(202)
  async receive(
    @Param('supplierId') supplierId: string,
    @Headers() inputHeaders: Record<string, string | string[] | undefined>,
    @Req() request: RawWebhookRequest,
    @Body() _body: unknown,
  ): Promise<{ accepted: true }> {
    travelMetrics.webhookEvents.inc(1, { supplier: supplierId });
    const rawBody = request.rawBody;
    if (!rawBody) throw new BadRequestException('raw webhook body is required');
    const headers = Object.fromEntries(Object.entries(inputHeaders).flatMap(([key, value]) => typeof value === 'string' ? [[key.toLowerCase(), value]] : []));
    const verified = this.verifier.verify({ ...headers, 'x-supplier-id': supplierId }, rawBody);
    try {
      this.replayGuard?.accept(verified.externalEventId, verified.timestampSeconds);
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate')) throw new ConflictException('duplicate webhook event');
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid webhook replay window');
    }
    const requestId = request.requestId ?? randomUUID();
    const correlationId = request.correlationId ?? requestId;
    const adapter = this.adapters.get(supplierId);
    if (!adapter?.parseWebhook) throw new ServiceUnavailableException('supplier webhook adapter unavailable');

    const parsed = SupplierOrderUpdateSchema.safeParse(await adapter.parseWebhook({ supplierId, rawBody, headers }));
    if (!parsed.success) throw new BadRequestException('supplier webhook adapter returned an invalid update');
    if (parsed.data.externalEventId !== verified.externalEventId
      || parsed.data.orderRef.supplierId !== verified.orderRef.supplierId
      || parsed.data.orderRef.supplierOrderId !== verified.orderRef.supplierOrderId) {
      throw new BadRequestException('supplier webhook identity mismatch');
    }
    const taskId = `webhook:${supplierId}:${verified.externalEventId}`;
    const orderId = this.intake.resolveOrderId ? await this.intake.resolveOrderId(verified.orderRef) : undefined;
    if (this.intake.resolveOrderId && !orderId) throw new ServiceUnavailableException('supplier order is not locally mapped; manual review required');
    const taskPayload = {
      ...(orderId ? { orderId } : {}),
      supplierId,
      externalEventId: verified.externalEventId,
      orderRef: verified.orderRef,
      source: 'webhook',
      requestId,
      correlationId,
    } as const;
    const accepted = await this.intake.accept({
      supplierId,
      externalEventId: verified.externalEventId,
      orderRef: verified.orderRef,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      taskId,
      taskPayload,
      requestId,
      correlationId,
    });
    if (!accepted) throw new ConflictException('duplicate webhook event');
    return { accepted: true };
  }
}
