import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '@travel/application';

const COOKIE_NAME = 'travel_session';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const ANONYMOUS_SESSION_CLOCK = Symbol('ANONYMOUS_SESSION_CLOCK');
export const ANONYMOUS_SESSION_STORE = Symbol('ANONYMOUS_SESSION_STORE');

export interface AnonymousSessionResult {
  id: string;
  cookie?: string;
  expired?: boolean;
}

export interface AnonymousSessionStore {
  resolve(token?: string): Promise<AnonymousSessionResult>;
  rotateExpired(sessionId: string): Promise<{ id: string; cookie: string }>;
  cleanupExpired(before: Date): Promise<number>;
}

@Injectable()
export class AnonymousSessionCleanupPort {
  private cleanup?: { purgeExpired(): Promise<number> | number };

  use(cleanup: { purgeExpired(): Promise<number> | number }): void {
    this.cleanup = cleanup;
  }

  purgeExpired(): Promise<number> | number {
    return this.cleanup?.purgeExpired() ?? 0;
  }
}

function cookieValue(header: string | undefined): string | undefined {
  return header?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
}

function cookie(id: string): string {
  return `${COOKIE_NAME}=${id}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`;
}

@Injectable()
export class AnonymousSessionProvider {
  private readonly sessions = new Map<string, number>();
  private readonly clock: { now(): Date; id(): string };

  constructor(
    @Optional() @Inject(ANONYMOUS_SESSION_CLOCK) clock?: { now(): Date; id(): string },
    @Optional() @Inject(ANONYMOUS_SESSION_STORE) private readonly store?: AnonymousSessionStore,
  ) {
    this.clock = clock ?? { now: () => new Date(), id: () => randomUUID() };
  }

  resolve(cookieHeader: string | undefined): AnonymousSessionResult | Promise<AnonymousSessionResult> {
    const token = cookieValue(cookieHeader);
    if (this.store) return this.store.resolve(token);
    if (token) {
      const expiresAt = this.sessions.get(token);
      if (!expiresAt) throw new ApplicationError('unauthorized', 'anonymous session is invalid');
      if (expiresAt <= this.clock.now().getTime()) return { id: token, expired: true };
      return { id: token };
    }
    const id = this.clock.id();
    this.sessions.set(id, this.clock.now().getTime() + RETENTION_MS);
    return { id, cookie: cookie(id) };
  }

  rotateExpired(sessionId: string): { id: string; cookie: string } | Promise<{ id: string; cookie: string }> {
    if (this.store) return this.store.rotateExpired(sessionId);
    const expiresAt = this.sessions.get(sessionId);
    if (!expiresAt || expiresAt > this.clock.now().getTime()) throw new ApplicationError('unauthorized', 'anonymous session is not expired');
    this.sessions.delete(sessionId);
    const id = this.clock.id();
    this.sessions.set(id, this.clock.now().getTime() + RETENTION_MS);
    return { id, cookie: cookie(id) };
  }

  cleanupExpired(before: Date): Promise<number> | number {
    if (this.store) return this.store.cleanupExpired(before);
    let deleted = 0;
    for (const [id, expiresAt] of this.sessions) {
      if (expiresAt <= before.getTime()) {
        this.sessions.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

@Injectable()
export class AnonymousSessionGuard implements CanActivate {
  constructor(
    @Inject(AnonymousSessionProvider) private readonly sessions: AnonymousSessionProvider,
    @Inject(AnonymousSessionCleanupPort) private readonly cleanup: AnonymousSessionCleanupPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ headers: { cookie?: string }; anonymousSessionId?: string; method?: string; url?: string }>();
    const reply = http.getResponse<{ header(name: string, value: string): void }>();
    await this.cleanup.purgeExpired();
    let session = await this.sessions.resolve(request.headers.cookie);
    if (session.expired) {
      if (request.method === 'POST' && request.url?.split('?')[0] === '/v1/conversations') {
        session = await this.sessions.rotateExpired(session.id);
      } else {
        throw new ApplicationError('unauthorized', 'anonymous session expired');
      }
    }
    request.anonymousSessionId = session.id;
    if (session.cookie) reply.header('set-cookie', session.cookie);
    return true;
  }
}
