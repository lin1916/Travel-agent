import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller.js';
import { BookingServiceImpl, InMemoryBookingStore } from '@travel/application';
import { MockOrderService } from '@travel/supplier-adapters';

@Module({ controllers: [BookingController], providers: [{ provide: BookingServiceImpl, useFactory: () => { if (process.env.NODE_ENV !== 'test') throw new Error('durable PostgreSQL booking repository is required for booking execution'); return new BookingServiceImpl(new InMemoryBookingStore(), new MockOrderService()); } }], exports: [BookingServiceImpl] })
export class BookingModule {}
