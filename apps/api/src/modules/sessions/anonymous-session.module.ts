import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database.module.js';
import {
  ANONYMOUS_SESSION_STORE,
  AnonymousSessionCleanupPort,
  AnonymousSessionGuard,
  AnonymousSessionProvider,
} from '../conversations/anonymous-session.js';
import { DurableAnonymousSessionStore } from './durable-anonymous-session-store.js';
import { CsrfController } from './csrf.controller.js';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [CsrfController],
  providers: [
    DurableAnonymousSessionStore,
    { provide: ANONYMOUS_SESSION_STORE, useExisting: DurableAnonymousSessionStore },
    AnonymousSessionProvider,
    AnonymousSessionCleanupPort,
    AnonymousSessionGuard,
  ],
  exports: [AnonymousSessionProvider, AnonymousSessionCleanupPort, AnonymousSessionGuard],
})
export class AnonymousSessionModule {}
