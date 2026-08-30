import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { IDENTITY_PROVIDER, type AuthenticatedActor, type IdentityProvider } from './identity-provider.js';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  actor?: AuthenticatedActor;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const session = value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : '';
    const actor = session ? await this.identity.verifySession(session) : null;
    if (!actor) throw new UnauthorizedException('authentication required');
    request.actor = actor;
    return true;
  }
}
