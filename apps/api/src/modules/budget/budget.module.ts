import { Module } from '@nestjs/common';
import { BudgetController } from './budget.controller.js';
import { TripModule } from '../trips/trip.module.js';

@Module({ imports: [TripModule], controllers: [BudgetController] })
export class BudgetModule {}
