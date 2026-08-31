import { describe, expect, it } from 'vitest';
import { faultModes, runFullTripScenario } from '@travel/testkit';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';

@Controller('/fixture')
class FixtureController {
  @Get('/full-trip')
  get() { return runFullTripScenario({ now: '2026-09-01T00:00:00.000+08:00' }); }
}

describe('full trip API fixture', () => {
  it('serves the workflow through an HTTP boundary', async () => {
    const module = await Test.createTestingModule({ controllers: [FixtureController] }).compile();
    const app: INestApplication = module.createNestApplication(new FastifyAdapter());
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const response = await request(app.getHttpServer()).get('/fixture/full-trip');
    expect(response.status).toBe(200);
    expect(response.body.workflow).toContain('api_order_committed');
    expect(response.body.unknownOrder.reconciliationStatus).toBe('pending');
    await app.close();
  });

  it('exposes the complete mock workflow state for API consumers', () => {
    const result = runFullTripScenario({ now: '2026-09-01T00:00:00.000+08:00' });
    expect(result.trip.id).toBe('trip-demo-001');
    expect(result.search.categories).toHaveLength(4);
    expect(result.apiOrder.status).toBe('confirmed');
    expect(result.redirectOrder.status).toBe('confirmed');
    expect(result.callbacks.accepted).toBe(2);
    expect(result.unknownOrder.reconciliationStatus).toBe('pending');
    expect(result.itinerary.confirmedItems.map(item => item.id)).toEqual(['item-train-001', 'item-stay-001']);
  });

  it('keeps every documented fault mode deterministic and non-leaking', () => {
    for (const fault of faultModes) expect(runFullTripScenario({ fault }).leakScan.matches).toEqual([]);
  });
});
