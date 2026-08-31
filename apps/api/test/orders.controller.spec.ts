import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { OrderController } from '../src/modules/orders/order.controller.js';
describe('OrderController auth', () => { it('throws Nest unauthorized exception when actor is absent', () => { const controller = new OrderController({ listByTrip: async () => [] } as any); expect(() => controller.list('', 'trip-1')).toThrow(UnauthorizedException); }); });
