import { Global, Module } from '@nestjs/common';
import { createDatabase } from '@travel/persistence';
import { isLocalPlanningMemoryMode } from './local-planning-memory-mode.js';

export const API_DATABASE = Symbol('API_DATABASE');

@Global()
@Module({
  providers: [{
    provide: API_DATABASE,
    useFactory: () => {
      if (isLocalPlanningMemoryMode() || (process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL?.trim())) return undefined;
      return createDatabase();
    },
  }],
  exports: [API_DATABASE],
})
export class DatabaseModule {}
