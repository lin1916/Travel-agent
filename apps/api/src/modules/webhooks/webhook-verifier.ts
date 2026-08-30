import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SupplierOrderRefSchema, type SupplierOrderRef } from '@travel/contracts';

export interface VerifiedWebhook {
  supplierId: string;
  externalEventId: string;
  orderRef: SupplierOrderRef;
  payload: unknown;
}

export interface WebhookVerifier {
  verify(headers: Record<string, string>, rawBody: Uint8Array): VerifiedWebhook;
}

export const WEBHOOK_VERIFIER = Symbol('WEBHOOK_VERIFIER');

function parseSignature(value: string): Buffer {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(value);
  if (!match?.[1]) throw new UnauthorizedException('invalid webhook signature');
  return Buffer.from(match[1], 'hex');
}

export class HmacWebhookVerifier implements WebhookVerifier {
  constructor(
    private readonly secretFor: (supplierId: string) => string | undefined,
    private readonly now: () => Date = () => new Date(),
    private readonly maxAgeSeconds = 300,
  ) {}

  verify(headers: Record<string, string>, rawBody: Uint8Array): VerifiedWebhook {
    const supplierId = headers['x-supplier-id'];
    const externalEventId = headers['x-webhook-event-id'];
    const timestamp = headers['x-webhook-timestamp'];
    const suppliedSignature = headers['x-webhook-signature'];
    if (!supplierId || !externalEventId || !timestamp || !suppliedSignature) {
      throw new UnauthorizedException('missing signed webhook headers');
    }
    const secret = this.secretFor(supplierId);
    if (!secret) throw new UnauthorizedException('unknown webhook supplier');

    const timestampSeconds = Number(timestamp);
    if (!Number.isSafeInteger(timestampSeconds)) throw new UnauthorizedException('invalid webhook timestamp');
    const ageSeconds = Math.abs(Math.floor(this.now().getTime() / 1_000) - timestampSeconds);
    if (ageSeconds > this.maxAgeSeconds) throw new UnauthorizedException('stale webhook timestamp');

    const expected = createHmac('sha256', secret)
      .update(timestamp)
      .update('.')
      .update(rawBody)
      .digest();
    const supplied = parseSignature(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException('invalid webhook signature');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('invalid webhook JSON');
    }
    if (!payload || typeof payload !== 'object') throw new BadRequestException('invalid webhook payload');
    const record = payload as Record<string, unknown>;
    if (record.externalEventId !== externalEventId) throw new UnauthorizedException('webhook event identity mismatch');
    const parsedOrderRef = SupplierOrderRefSchema.safeParse(record.orderRef);
    if (!parsedOrderRef.success || parsedOrderRef.data.supplierId !== supplierId) {
      throw new BadRequestException('invalid webhook order reference');
    }
    return { supplierId, externalEventId, orderRef: parsedOrderRef.data, payload };
  }
}
