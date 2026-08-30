import { Module } from '@nestjs/common';
import { ItineraryController } from './itinerary.controller.js';
import { TripModule } from '../trips/trip.module.js';

@Module({ imports: [TripModule], controllers: [ItineraryController] })
export class ItineraryModule {}
