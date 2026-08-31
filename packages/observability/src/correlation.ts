import { randomUUID } from 'node:crypto';
export interface CorrelationContext { requestId: string; correlationId: string }
export function createCorrelationContext(input?: Partial<CorrelationContext>): CorrelationContext { return { requestId: input?.requestId || randomUUID(), correlationId: input?.correlationId || input?.requestId || randomUUID() }; }
export function childCorrelation(parent: CorrelationContext, requestId?: string): CorrelationContext { return { requestId: requestId || randomUUID(), correlationId: parent.correlationId }; }
export function withCorrelation<T>(ctx: CorrelationContext, fn: (ctx: CorrelationContext) => T): T { return fn(ctx); }
