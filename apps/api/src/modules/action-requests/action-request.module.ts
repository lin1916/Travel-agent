import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ActionRequestController } from './action-request.controller.js';
import { ActionRequestService } from '@travel/application';

import { ACTION_REQUEST_SERVICE } from './action-request.tokens.js';

@Module({ imports: [AuthModule], controllers: [ActionRequestController], providers: [{ provide: ACTION_REQUEST_SERVICE, useClass: ActionRequestService }], exports: [ACTION_REQUEST_SERVICE] })
export class ActionRequestModule {}
