import type { PlanningContext } from './planning-context.js';
import { z } from 'zod';

export type ConversationRole = 'user' | 'assistant';
export type ClientMessageId = string;
export const ClientMessageIdSchema = z.string().uuid();

export interface ConversationMessage {
  id: string;
  clientMessageId?: ClientMessageId;
  role: ConversationRole;
  content: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  providerName: string;
  model: string;
  status: 'active' | 'failed';
  messages: ConversationMessage[];
  tripId?: string;
  agentRunId?: string;
  planningContext?: PlanningContext;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ConversationTurnEvent {
  event_id: string;
  event_type: 'ConversationMessageCreated' | 'ConversationFailed' | 'AgentTurnStarted' | 'PlanningContextUpdated' | 'ReasoningSummaryUpdated' | 'ToolCallStarted' | 'ToolCallCompleted' | 'ToolCallFailed' | 'PlanProposalCreated' | 'AgentMessageCompleted' | 'AgentTurnFailed';
  aggregate_type: 'conversation';
  aggregate_id: string;
  run_id?: string;
  sequence: number;
  schema_version: 1;
  occurred_at: string;
  request_id: string;
  correlation_id: string;
  redacted_payload: Record<string, unknown>;
}
