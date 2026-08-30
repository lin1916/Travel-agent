import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MandateController } from './mandate.controller.js';
import { MandateStore } from '@travel/application';
import { MANDATE_STORE } from './mandate.tokens.js';

@Module({ imports: [AuthModule], controllers: [MandateController], providers: [{ provide: MANDATE_STORE, useClass: MandateStore }], exports: [MANDATE_STORE] })
export class MandateModule {}
