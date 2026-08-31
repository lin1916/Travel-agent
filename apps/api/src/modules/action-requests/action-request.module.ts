import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ActionRequestController } from './action-request.controller.js';
import { ActionRequestService } from '@travel/application';
import { ActionRequestRepository, createDatabase } from '@travel/persistence';

import { ACTION_REQUEST_SERVICE } from './action-request.tokens.js';
import { travelMetrics } from '@travel/observability';

@Module({ imports: [AuthModule], controllers: [ActionRequestController], providers: [{ provide: ACTION_REQUEST_SERVICE, useFactory: () => { if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'test') return new ActionRequestService(undefined, undefined, travelMetrics); return new ActionRequestService(undefined, new ActionRequestRepository(createDatabase()) as never, travelMetrics); } }], exports: [ACTION_REQUEST_SERVICE] })
export class ActionRequestModule {}
