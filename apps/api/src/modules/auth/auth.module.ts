import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { DevIdentityProvider } from './dev-identity-provider.js';
import { IDENTITY_PROVIDER, UnavailableIdentityProvider, type IdentityProvider } from './identity-provider.js';

function identityProvider(): IdentityProvider {
  if ((process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test')
    || !process.env.DEV_IDENTITY_CODE
    || !process.env.DEV_IDENTITY_ACTOR_ID) {
    return new UnavailableIdentityProvider();
  }
  return DevIdentityProvider.fromEnvironment(process.env);
}

@Module({
  controllers: [AuthController],
  providers: [
    { provide: IDENTITY_PROVIDER, useFactory: identityProvider },
    AuthGuard,
  ],
  exports: [IDENTITY_PROVIDER, AuthGuard],
})
export class AuthModule {}
