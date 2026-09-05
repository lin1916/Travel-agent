import { describe, expect, it } from 'vitest';
import { createPlanContextProvider } from '../src/modules/plans/plan.module.js';

describe('planning context composition', () => {
  it('loads traveler count and total budget from authoritative services', async () => {
    const provider = createPlanContextProvider(
      { getAny: async () => ({ travelerCount: 3 }) },
      { get: async () => ({ totalLimit: { amountCents: 750_000 } }) },
    );

    await expect(provider('trip-1', 'owner-1')).resolves.toEqual({ travelerCount: 3, totalBudgetCents: 750_000 });
  });

  it('keeps anonymous conversations without a trip context', async () => {
    const provider = createPlanContextProvider(
      { getAny: async () => null },
      { get: async () => ({ totalLimit: { amountCents: 750_000 } }) },
    );

    await expect(provider('conversation-1', 'anonymous')).resolves.toBeUndefined();
  });
});
