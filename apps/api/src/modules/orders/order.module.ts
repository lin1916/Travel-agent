import { Module } from '@nestjs/common';
import { OrderQueryService } from '@travel/application';
import { BookingRepository, createDatabase } from '@travel/persistence';
import { OrderController } from './order.controller.js';
@Module({ controllers: [OrderController], providers: [{ provide: OrderQueryService, useFactory: () => { const databaseUrl = process.env.DATABASE_URL; if (!databaseUrl) throw new Error('orders persistence unavailable: DATABASE_URL is required'); return new OrderQueryService(new BookingRepository(createDatabase(databaseUrl))); } }] })
export class OrderModule {}
