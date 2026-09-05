import { describe, expect, it } from 'vitest';
import { createRedactedLogger, serializeLogEvent } from '../src/logger.js';
import { MetricsRegistry, createTravelMetrics } from '../src/metrics.js';

describe('redacted observability', () => {
  it('never emits traveler, authorization, or encrypted values', () => {
    const output: string[] = [];
    const logger = createRedactedLogger((line) => output.push(line));
    const secret = '张三';
    const idNumber = '110101199001011234';
    const phone = '13800138000';
    const payment = '4111111111111111';
    const encrypted = 'eyJjaXBoZXJ0ZXh0IjoiU0VOU0lUSVZFIn0=';
    const paymentReference = 'pay-ref-secret';
    logger.info({ name: 'booking', requestId: 'req-1', correlationId: 'corr-1', fields: { secret, idNumber, phone, payment, paymentReference, authorization: 'Bearer top-secret', encrypted } });
    expect(output.join('')).not.toContain(secret);
    expect(output.join('')).not.toContain(idNumber);
    expect(output.join('')).not.toContain(phone);
    expect(output.join('')).not.toContain(payment);
    expect(output.join('')).not.toContain('top-secret');
    expect(output.join('')).not.toContain(encrypted);
    expect(output.join('')).not.toContain(paymentReference);
  });

  it('serializes only stable correlation identifiers and safe fields', () => {
    const serialized = serializeLogEvent({ name: 'x', requestId: 'req', correlationId: 'corr', fields: { orderId: 'order-1' } });
    expect(serialized).toContain('req');
    expect(serialized).toContain('corr');
    expect(serialized).toContain('order-1');
  });

  it('does not serialize caller-controlled sensitive request or correlation IDs', () => {
    const serialized = serializeLogEvent({ name: 'x', requestId: '13800138000', correlationId: '110101199001011234', fields: {} });
    expect(serialized).not.toContain('13800138000');
    expect(serialized).not.toContain('110101199001011234');
  });

  it('exposes named travel workflow metrics instead of an unlabelled empty registry', () => {
    const travel = createTravelMetrics(new MetricsRegistry());
    travel.unknownOrders.inc();
    expect(travel.unknownOrders.value()).toBe(1);
    expect(travel.supplierErrors).toBeDefined();
    expect(travel.modelLatency).toBeDefined();
  });
});
