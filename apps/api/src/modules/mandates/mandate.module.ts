import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MandateController } from './mandate.controller.js';
import { MandateStore } from '@travel/application';
import { createDatabase, MandateRepository } from '@travel/persistence';
import { MANDATE_STORE } from './mandate.tokens.js';

@Module({ imports: [AuthModule], controllers: [MandateController], providers: [{ provide: MANDATE_STORE, useFactory: () => { if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'test') return new MandateStore(); return new MandateRepository(createDatabase()); } }], exports: [MANDATE_STORE] })
export class MandateModule {}
