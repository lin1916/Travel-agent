import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RedirectContext, RedirectTokenService } from '@travel/contracts';

export class RedirectTokenServiceImpl implements RedirectTokenService {
  private readonly used = new Set<string>();
  private readonly actors = new Map<string, string>();
  constructor(private readonly key: string) {}
  async issue(input: RedirectContext, expiresAt: Date, actorId?: string): Promise<string> {
    const context = { intentId: input.intentId, supplierId: input.supplierId, nonce: input.nonce || randomUUID(), issuedAt: input.issuedAt, expiresAt: expiresAt.toISOString() };
    const payload = Buffer.from(JSON.stringify(context)).toString('base64url');
    if (actorId) this.actors.set(context.nonce, actorId);
    return `${payload}.${this.sign(payload)}`;
  }
  async verify(token: string, now: Date, binding?: { actorId?: string; supplierId?: string }): Promise<RedirectContext> {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw new Error('invalid redirect token');
    const expectedSignature = this.sign(payload);
    if (signature.length !== expectedSignature.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) throw new Error('invalid redirect token signature');
    let context: RedirectContext;
    try { context = JSON.parse(Buffer.from(payload, 'base64url').toString()) as RedirectContext; } catch { throw new Error('invalid redirect token payload'); }
    if (Object.keys(context).some(key => !['intentId', 'supplierId', 'nonce', 'issuedAt', 'expiresAt'].includes(key))) throw new Error('invalid redirect token fields');
    if (binding?.supplierId && context.supplierId !== binding.supplierId) throw new Error('redirect token supplier mismatch');
    if (binding?.actorId && this.actors.get(context.nonce) !== binding.actorId) throw new Error('redirect token actor mismatch');
    if (Date.parse(context.expiresAt) <= now.getTime()) throw new Error('redirect token expired');
    if (this.used.has(context.nonce)) throw new Error('redirect token replay');
    this.used.add(context.nonce);
    return context;
  }
  private sign(payload: string): string { return createHmac('sha256', this.key).update(payload).digest('base64url'); }
}
