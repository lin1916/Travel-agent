import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database.module.js';
import { TripController } from './trip.controller.js';
import { tripProviders } from './trip.providers.js';

@Module({ imports: [DatabaseModule], controllers: [TripController], providers: tripProviders, exports: tripProviders })
export class TripModule {}
