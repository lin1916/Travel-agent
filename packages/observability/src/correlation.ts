import { randomUUID } from 'node:crypto';
export interface CorrelationContext { requestId: string; correlationId: string }
export interface CorrelatedRequest { requestId?: string; correlationId?: string }
export function createCorrelationContext(input?: Partial<CorrelationContext>): CorrelationContext {
  const requestId = input?.requestId || randomUUID();
  return { requestId, correlationId: input?.correlationId || requestId };
}
export function childCorrelation(parent: CorrelationContext, requestId?: string): CorrelationContext { return { requestId: requestId || randomUUID(), correlationId: parent.correlationId }; }
export function ensureCorrelationContext(request: CorrelatedRequest): CorrelationContext {
  const context = createCorrelationContext({ requestId: request.requestId, correlationId: request.correlationId });
  request.requestId = context.requestId;
  request.correlationId = context.correlationId;
  return context;
}
export function withCorrelation<T>(ctx: CorrelationContext, fn: (ctx: CorrelationContext) => T): T { return fn(ctx); }
