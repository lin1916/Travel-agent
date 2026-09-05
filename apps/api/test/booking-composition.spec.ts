import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { BookingServiceImpl } from '@travel/application';
import { BookingModule } from '../src/modules/bookings/booking.module.js';

describe('booking production composition', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it('boots with PostgreSQL providers even when booking execution remains fail-closed', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://booking-composition@127.0.0.1:5432/travel_agent';

    const module = await Test.createTestingModule({ imports: [BookingModule] }).compile();
    expect(module.get(BookingServiceImpl)).toBeInstanceOf(BookingServiceImpl);
    await module.close();
  });
});
