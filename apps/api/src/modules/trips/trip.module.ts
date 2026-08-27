import { Module } from '@nestjs/common';
import { TripController } from './trip.controller.js';

@Module({ controllers: [TripController] })
export class TripModule {}
