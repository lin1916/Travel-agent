import { createAppError, type RiskLevel } from '@travel/contracts';
import type { CapabilityContext } from './context.js';
import type { CapabilityTool } from './tool.js';

const riskRank: Record<RiskLevel, number> = { read: 0, prepare: 1, commit: 2, redirect: 2 };

export interface PolicyDecision { allowed: boolean; reason?: string }

/** Pure policy evaluation. Inputs are treated as opaque tool data. */
export class PolicyChecker {
  check<I, O>(tool: CapabilityTool<I, O>, context: CapabilityContext): PolicyDecision {
    const requestedRisk = context.requestedRisk ?? 'read';
    if (riskRank[tool.risk] > riskRank[requestedRisk]) {
      return { allowed: false, reason: `requested risk ${requestedRisk} does not permit ${tool.risk}` };
    }
    if ((tool.risk === 'commit' || tool.risk === 'redirect') && !context.actorAuthenticated) {
      return { allowed: false, reason: 'an authenticated actor is required for external side effects' };
    }
    if (context.tripOwnerId && context.actorId !== context.tripOwnerId) {
      return { allowed: false, reason: 'actor does not own the trip' };
    }
    if (context.expectedTripVersion !== undefined && context.currentTripVersion === undefined) {
      return { allowed: false, reason: 'current trip version is required' };
    }
    if (
      context.currentTripVersion !== undefined &&
      context.expectedTripVersion !== undefined &&
      context.currentTripVersion !== context.expectedTripVersion
    ) {
      return { allowed: false, reason: 'trip version changed' };
    }
    if (!context.correlationId.trim()) {
      return { allowed: false, reason: 'correlation id is required' };
    }
    return { allowed: true };
  }

  blocked(context: CapabilityContext, reason: string) {
    return createAppError('policy_blocked', context.correlationId || 'unknown', reason);
  }
}
