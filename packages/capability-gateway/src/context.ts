import { z } from 'zod';
import { RiskLevelSchema, type RiskLevel } from '@travel/contracts';

/** Context that is injected into every capability invocation. */
export interface CapabilityContext {
  actorId: string;
  conversationId?: string;
  tripId?: string;
  agentRunId: string;
  actionRequestId?: string;
  mandateId?: string;
  correlationId: string;
  /** The maximum risk the caller has requested for this turn. */
  requestedRisk?: RiskLevel;
  /** Set when the actor was authenticated by the API. */
  actorAuthenticated?: boolean;
  /** Optional ownership/version facts supplied by the application layer. */
  tripOwnerId?: string;
  currentTripVersion?: number;
  expectedTripVersion?: number;
}

export const CapabilityContextSchema = z.object({
  actorId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  tripId: z.string().min(1).optional(),
  agentRunId: z.string().min(1),
  actionRequestId: z.string().min(1).optional(),
  mandateId: z.string().min(1).optional(),
  correlationId: z.string().min(1),
  requestedRisk: RiskLevelSchema.optional(),
  actorAuthenticated: z.boolean().optional(),
  tripOwnerId: z.string().min(1).optional(),
  currentTripVersion: z.number().int().positive().optional(),
  expectedTripVersion: z.number().int().positive().optional(),
}).refine(context => Boolean(context.conversationId || context.tripId), {
  message: 'conversationId or tripId is required',
});
