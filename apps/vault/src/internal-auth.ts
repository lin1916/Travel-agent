import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

export interface InternalServiceIdentity {
  serviceId: string;
}

export interface InternalServiceRequest {
  headers: Record<string, string | string[] | undefined>;
  serviceIdentity?: InternalServiceIdentity;
}

export interface InternalServiceAuthenticator {
  authenticate(token: string): InternalServiceIdentity;
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createInternalServiceAuthenticator(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): InternalServiceAuthenticator {
  const token = environment.VAULT_INTERNAL_SERVICE_TOKEN;
  if (!token) throw new Error('VAULT_INTERNAL_SERVICE_TOKEN is required');
  const serviceId = environment.VAULT_INTERNAL_SERVICE_ID ?? 'travel-api';
  return {
    authenticate(candidate: string): InternalServiceIdentity {
      if (!candidate || !equalSecret(candidate, token)) {
        throw new Error('internal authentication failed');
      }
      return { serviceId };
    },
  };
}

@Injectable()
export class InternalServiceAuthGuard implements CanActivate {
  constructor(private readonly authenticator: InternalServiceAuthenticator) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<InternalServiceRequest>();
    const header = request.headers['x-vault-service-token'];
    const token = Array.isArray(header) ? header[0] : header;
    try {
      request.serviceIdentity = this.authenticator.authenticate(token ?? '');
      return true;
    } catch {
      throw new UnauthorizedException('internal authentication required');
    }
  }
}

export function ownerIdFromRequest(request: InternalServiceRequest): string {
  const header = request.headers['x-vault-owner-id'];
  const ownerId = Array.isArray(header) ? header[0] : header;
  if (!ownerId || !request.serviceIdentity) throw new UnauthorizedException('internal owner identity required');
  return ownerId;
}
