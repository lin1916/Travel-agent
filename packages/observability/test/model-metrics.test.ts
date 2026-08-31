import { describe, expect, it } from 'vitest';
import { createTravelMetrics, MetricsRegistry } from '../src/metrics.js';
describe('model metrics semantics', () => { it('names model timing as latency, not cost', () => { const m=createTravelMetrics(new MetricsRegistry()); expect(m.modelLatency).toBeDefined(); expect((m as any).modelCost).toBeUndefined(); }); });
