import { Module } from '@nestjs/common';
import { BudgetController } from './budget.controller.js';

@Module({ controllers: [BudgetController] })
export class BudgetModule {}
