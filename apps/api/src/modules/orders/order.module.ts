import { Module } from '@nestjs/common';
import { OrderQueryService } from '@travel/application';
import { OrderController } from './order.controller.js';
@Module({ controllers: [OrderController], providers: [{ provide: OrderQueryService, useFactory: () => new OrderQueryService({ listByTrip: async () => [] }) }] })
export class OrderModule {}
