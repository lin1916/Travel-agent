import { Module } from '@nestjs/common';
import { TripController } from './trip.controller.js';
import { tripProviders } from './trip.providers.js';

@Module({ controllers: [TripController], providers: tripProviders, exports: tripProviders })
export class TripModule {}
