import { Module } from '@nestjs/common';
import { ItineraryController } from './itinerary.controller.js';

@Module({ controllers: [ItineraryController] })
export class ItineraryModule {}
