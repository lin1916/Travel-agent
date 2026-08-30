import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RedirectContext, RedirectTokenService } from '@travel/contracts';

export interface RedirectNonceStore { claim(nonce: string): Promise<boolean> }
export class InMemoryRedirectNonceStore implements RedirectNonceStore {
  private readonly used = new Set<string>();
  async claim(nonce: string): Promise<boolean> { if (this.used.has(nonce)) return false; this.used.add(nonce); return true; }
}

export class RedirectTokenServiceImpl implements RedirectTokenService {
  constructor(private readonly key: string, private readonly nonces: RedirectNonceStore = new InMemoryRedirectNonceStore()) {}
  async issue(input: RedirectContext, expiresAt: Date, actorId?: string): Promise<string> {
    if (!actorId) throw new Error('actor binding is required');
    if (!input.intentId || !input.supplierId || !input.issuedAt || !Number.isFinite(Date.parse(input.issuedAt))) throw new Error('invalid redirect context');
    if (expiresAt.getTime() <= Date.parse(input.issuedAt)) throw new Error('invalid redirect expiry');
    const context = { intentId: input.intentId, supplierId: input.supplierId, nonce: input.nonce || randomUUID(), issuedAt: new Date(input.issuedAt).toISOString(), expiresAt: expiresAt.toISOString() };
    const payload = Buffer.from(JSON.stringify(context)).toString('base64url');
    return `${payload}.${this.sign(payload, actorId)}`;
  }
  async verify(token: string, now: Date, binding?: { actorId?: string; supplierId?: string }): Promise<RedirectContext> {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw new Error('invalid redirect token');
    if (!binding?.actorId) throw new Error('actor binding is required');
    const expectedSignature = this.sign(payload, binding.actorId);
    if (signature.length !== expectedSignature.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) throw new Error('invalid redirect token signature');
    let context: RedirectContext;
    try { context = JSON.parse(Buffer.from(payload, 'base64url').toString()) as RedirectContext; } catch { throw new Error('invalid redirect token payload'); }
    if (Object.keys(context).length !== 5 || Object.keys(context).some(key => !['intentId', 'supplierId', 'nonce', 'issuedAt', 'expiresAt'].includes(key))) throw new Error('invalid redirect token fields');
    if (!context.intentId || !context.supplierId || !context.nonce || !context.issuedAt || !context.expiresAt || Number.isNaN(Date.parse(context.issuedAt)) || Number.isNaN(Date.parse(context.expiresAt))) throw new Error('invalid redirect token fields');
    if (!binding.supplierId) throw new Error('supplier binding is required');
    if (context.supplierId !== binding.supplierId) throw new Error('redirect token supplier mismatch');
    if (Date.parse(context.expiresAt) <= now.getTime()) throw new Error('redirect token expired');
    if (!(await this.nonces.claim(context.nonce))) throw new Error('redirect token replay');
    return context;
  }
  private sign(payload: string, actorId: string): string { const actorKey = createHmac('sha256', this.key).update(`actor:${actorId}`).digest(); return createHmac('sha256', actorKey).update(payload).digest('base64url'); }
}
