export interface LoginInput {
  developmentCode: string;
}

export interface AuthenticatedActor {
  actorId: string;
  sessionId: string;
}

export interface IdentityProvider {
  authenticate(input: LoginInput): Promise<AuthenticatedActor>;
  verifySession(session: string): Promise<AuthenticatedActor | null>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export class UnavailableIdentityProvider implements IdentityProvider {
  async authenticate(): Promise<AuthenticatedActor> {
    throw new Error('authentication failed');
  }

  async verifySession(): Promise<AuthenticatedActor | null> {
    return null;
  }
}
