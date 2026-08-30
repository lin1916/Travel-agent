import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SUPPLIER_ADAPTER_REGISTRY,
  WEBHOOK_INTAKE,
  WebhookController,
  type WebhookIntake,
} from '../src/modules/webhooks/webhook.controller.js';
import { HmacWebhookVerifier, WEBHOOK_VERIFIER } from '../src/modules/webhooks/webhook-verifier.js';

const now = new Date('2026-08-30T12:00:00.000Z');
const timestamp = String(Math.floor(now.getTime() / 1_000));
const secret = 'supplier-test-secret';

function signature(rawBody: string, signedAt = timestamp): string {
  return `sha256=${createHmac('sha256', secret).update(`${signedAt}.${rawBody}`).digest('hex')}`;
}

describe('supplier webhook boundary', () => {
  let app: INestApplication;
  const queued: Array<{ taskId: string; payload: Record<string, unknown> }> = [];
  const claimed = new Set<string>();

  beforeAll(async () => {
    const intake: WebhookIntake = {
      async resolveOrderId(orderRef) {
        return orderRef.supplierOrderId === 'supplier-order-1' ? 'local-order-42' : null;
      },
      async accept(input) {
        const key = `${input.supplierId}:${input.externalEventId}`;
        if (claimed.has(key)) return false;
        claimed.add(key);
        queued.push({ taskId: input.taskId, payload: input.taskPayload });
        return true;
      },
    };
    const adapter = {
      supplierId: 'mock-train',
      kind: 'train' as const,
      async parseWebhook() {
        return {
          externalEventId: 'external-event-1',
          orderRef: { supplierId: 'mock-train', supplierOrderId: 'supplier-order-1' },
          lifecycleStatus: 'payment_unknown' as const,
          paymentVerified: false,
        };
      },
    };
    const module = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: WEBHOOK_VERIFIER, useValue: new HmacWebhookVerifier(id => id === 'mock-train' ? secret : undefined, () => now) },
        { provide: WEBHOOK_INTAKE, useValue: intake },
        { provide: SUPPLIER_ADAPTER_REGISTRY, useValue: { get: (id: string) => id === 'mock-train' ? adapter : undefined } },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { rawBody: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it('verifies the exact raw body, ignores client status, and enqueues deterministic reconciliation work', async () => {
    const rawBody = '{"externalEventId":"external-event-1","orderRef":{"supplierId":"mock-train","supplierOrderId":"supplier-order-1"},"status":"confirmed"}';
    const response = await request(app.getHttpServer())
      .post('/v1/webhooks/suppliers/mock-train')
      .set('content-type', 'application/json')
      .set('x-webhook-timestamp', timestamp)
      .set('x-webhook-event-id', 'external-event-1')
      .set('x-webhook-signature', signature(rawBody))
      .send(rawBody);

    expect(response.status).toBe(202);
    expect(queued).toEqual([{
      taskId: 'webhook:mock-train:external-event-1',
      payload: {
        orderId: 'local-order-42',
        supplierId: 'mock-train',
        externalEventId: 'external-event-1',
        orderRef: { supplierId: 'mock-train', supplierOrderId: 'supplier-order-1' },
        source: 'webhook',
      },
    }]);
    expect(JSON.stringify(queued[0])).not.toContain('confirmed');
  });

  it('rejects a duplicate external event ID', async () => {
    const rawBody = '{"externalEventId":"external-event-1","orderRef":{"supplierId":"mock-train","supplierOrderId":"supplier-order-1"}}';
    const response = await request(app.getHttpServer())
      .post('/v1/webhooks/suppliers/mock-train')
      .set('content-type', 'application/json')
      .set('x-webhook-timestamp', timestamp)
      .set('x-webhook-event-id', 'external-event-1')
      .set('x-webhook-signature', signature(rawBody))
      .send(rawBody);
    expect(response.status).toBe(409);
    expect(queued).toHaveLength(1);
  });

  it('rejects stale timestamps and signatures for different raw bytes', async () => {
    const rawBody = '{"externalEventId":"external-event-2","orderRef":{"supplierId":"mock-train","supplierOrderId":"supplier-order-1"}}';
    const stale = String(Number(timestamp) - 301);
    const staleResponse = await request(app.getHttpServer())
      .post('/v1/webhooks/suppliers/mock-train')
      .set('content-type', 'application/json')
      .set('x-webhook-timestamp', stale)
      .set('x-webhook-event-id', 'external-event-2')
      .set('x-webhook-signature', signature(rawBody, stale))
      .send(rawBody);
    expect(staleResponse.status).toBe(401);

    const tamperedResponse = await request(app.getHttpServer())
      .post('/v1/webhooks/suppliers/mock-train')
      .set('content-type', 'application/json')
      .set('x-webhook-timestamp', timestamp)
      .set('x-webhook-event-id', 'external-event-2')
      .set('x-webhook-signature', signature(rawBody + ' '))
      .send(rawBody);
    expect(tamperedResponse.status).toBe(401);
    expect(queued).toHaveLength(1);
  });
});
