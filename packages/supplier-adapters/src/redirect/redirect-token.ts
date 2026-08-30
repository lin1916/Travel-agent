import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RedirectContext, RedirectTokenService } from '@travel/contracts';

export class RedirectTokenServiceImpl implements RedirectTokenService {
  private readonly used = new Set<string>();
  constructor(private readonly key: string) {}
  async issue(input: RedirectContext, expiresAt: Date): Promise<string> {
    const context = { ...input, nonce: input.nonce || randomUUID(), expiresAt: expiresAt.toISOString() };
    const payload = Buffer.from(JSON.stringify(context)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }
  async verify(token: string, now: Date): Promise<RedirectContext> {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw new Error('invalid redirect token');
    const expected = this.sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('invalid redirect token signature');
    let context: RedirectContext;
    try { context = JSON.parse(Buffer.from(payload, 'base64url').toString()) as RedirectContext; } catch { throw new Error('invalid redirect token payload'); }
    if (Date.parse(context.expiresAt) <= now.getTime()) throw new Error('redirect token expired');
    if (this.used.has(context.nonce)) throw new Error('redirect token replay');
    this.used.add(context.nonce);
    return context;
  }
  private sign(payload: string): string { return createHmac('sha256', this.key).update(payload).digest('base64url'); }
}
