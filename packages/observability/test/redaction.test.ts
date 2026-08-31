import { describe, expect, it } from 'vitest';
import { createRedactedLogger, serializeLogEvent } from '../src/logger.js';

describe('redacted observability', () => {
  it('never emits traveler, authorization, or encrypted values', () => {
    const output: string[] = [];
    const logger = createRedactedLogger((line) => output.push(line));
    const secret = '张三';
    const idNumber = '110101199001011234';
    const phone = '13800138000';
    const payment = '4111111111111111';
    const encrypted = 'eyJjaXBoZXJ0ZXh0IjoiU0VOU0lUSVZFIn0=';
    logger.info({ name: 'booking', requestId: 'req-1', correlationId: 'corr-1', fields: { secret, idNumber, phone, payment, authorization: 'Bearer top-secret', encrypted } });
    expect(output.join('')).not.toContain(secret);
    expect(output.join('')).not.toContain(idNumber);
    expect(output.join('')).not.toContain(phone);
    expect(output.join('')).not.toContain(payment);
    expect(output.join('')).not.toContain('top-secret');
    expect(output.join('')).not.toContain(encrypted);
  });

  it('serializes only stable correlation identifiers and safe fields', () => {
    const serialized = serializeLogEvent({ name: 'x', requestId: 'req', correlationId: 'corr', fields: { orderId: 'order-1' } });
    expect(serialized).toContain('req');
    expect(serialized).toContain('corr');
    expect(serialized).toContain('order-1');
  });
});
