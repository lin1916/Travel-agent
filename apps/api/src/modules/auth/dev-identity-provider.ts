import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthenticatedActor, IdentityProvider, LoginInput } from './identity-provider.js';

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export class DevIdentityProvider implements IdentityProvider {
  private readonly sessions = new Map<string, AuthenticatedActor>();

  private constructor(
    private readonly developmentCode: string,
    private readonly actorId: string,
  ) {}

  static fromEnvironment(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): DevIdentityProvider {
    if (environment.NODE_ENV === 'production') {
      throw new Error('development identity provider is disabled in production');
    }
    if (!environment.DEV_IDENTITY_CODE || !environment.DEV_IDENTITY_ACTOR_ID) {
      throw new Error('development identity provider is not configured');
    }
    return new DevIdentityProvider(environment.DEV_IDENTITY_CODE, environment.DEV_IDENTITY_ACTOR_ID);
  }

  async authenticate(input: LoginInput): Promise<AuthenticatedActor> {
    if (!input.developmentCode || !equalSecret(input.developmentCode, this.developmentCode)) {
      throw new Error('authentication failed');
    }
    const actor = { actorId: this.actorId, sessionId: randomUUID() };
    this.sessions.set(actor.sessionId, actor);
    return { ...actor };
  }

  async verifySession(session: string): Promise<AuthenticatedActor | null> {
    const actor = this.sessions.get(session);
    return actor ? { ...actor } : null;
  }
}
