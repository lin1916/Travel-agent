import { Body, Controller, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { IDENTITY_PROVIDER, type IdentityProvider, type LoginInput } from './identity-provider.js';

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider) {}

  @Post('dev-login')
  async login(@Body() input: LoginInput) {
    try {
      return await this.identity.authenticate(input);
    } catch {
      throw new UnauthorizedException('authentication failed');
    }
  }
}
