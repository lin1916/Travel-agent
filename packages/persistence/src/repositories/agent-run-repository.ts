import type {
  AgentRunStatus,
  PlanProposalDraft,
  PlanningContext,
  PlanningContextField,
  ToolCallSummary,
} from '@travel/contracts';
import { redactSensitiveText } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database, AgentRunsTable } from '../types.js';

/** Persistence-local shape kept structurally compatible with agent-runtime. */
export interface AgentRunSnapshot {
  runId: string;
  conversationId?: string;
  tripId?: string;
  actorId?: string;
  requestId?: string;
  correlationId?: string;
  status: AgentRunStatus;
  userMessage: string;
  currentTripVersion?: number;
  planningContext?: PlanningContext;
  assistantMessage: string;
  missingFields: PlanningContextField[];
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
  actionRequests: Array<{ kind: string; resourceId: string }>;
  planProposal?: PlanProposalDraft | null;
  reasoningSummary?: string;
  toolCallSummaries: ToolCallSummary[];
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunSerialized {
  id: string;
  conversation_id: string | null;
  trip_id: string | null;
  actor_id: string | null;
  status: string;
  user_message: string;
  assistant_message: string;
  missing_fields_json: string;
  tool_calls_json: string;
  tool_call_summaries_json: string;
  action_requests_json: string;
  planning_context_json: string | null;
  reasoning_summary: string | null;
  plan_proposal_json: string | null;
  request_id: string | null;
  correlation_id: string | null;
  next_step: string | null;
  current_trip_version: number | null;
  created_at: string;
  updated_at: string;
}

function safeText(value: string): string {
  return redactSensitiveText(value);
}

const emptyContext = (run: Pick<AgentRunSnapshot, 'conversationId' | 'updatedAt'>): PlanningContext => ({
  conversationId: run.conversationId ?? '',
  version: 1,
  preferences: [],
  assumptions: [],
  missingFields: ['destination', 'startsAt', 'endsAt', 'travelerCount'],
  updatedAt: run.updatedAt,
});

export function serializeAgentRun(run: AgentRunSnapshot): AgentRunSerialized {
  const planningContext = run.planningContext ?? emptyContext(run);
  return {
    id: run.runId,
    conversation_id: run.conversationId ?? null,
    trip_id: run.tripId ?? null,
    actor_id: run.actorId ?? null,
    status: run.status,
    user_message: safeText(run.userMessage),
    assistant_message: safeText(run.assistantMessage),
    missing_fields_json: JSON.stringify(run.missingFields),
    tool_calls_json: JSON.stringify(run.toolCalls),
    tool_call_summaries_json: JSON.stringify(run.toolCallSummaries),
    action_requests_json: JSON.stringify(run.actionRequests),
    planning_context_json: JSON.stringify(planningContext),
    reasoning_summary: run.reasoningSummary ? safeText(run.reasoningSummary) : null,
    plan_proposal_json: run.planProposal ? JSON.stringify(run.planProposal) : null,
    next_step: run.nextStep ?? null,
    current_trip_version: run.currentTripVersion ?? null,
    request_id: run.requestId ?? null,
    correlation_id: run.correlationId ?? null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function deserializeAgentRun(row: AgentRunSerialized | AgentRunsTable): AgentRunSnapshot {
  const context = parseJson<PlanningContext | undefined>(row.planning_context_json, undefined);
  return {
    runId: row.id,
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    ...(row.trip_id ? { tripId: row.trip_id } : {}),
    ...(row.actor_id ? { actorId: row.actor_id } : {}),
    ...(row.request_id ? { requestId: row.request_id } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    status: row.status as AgentRunStatus,
    userMessage: safeText(row.user_message),
    ...(row.current_trip_version === null ? {} : { currentTripVersion: Number(row.current_trip_version) }),
    ...(context ? { planningContext: context } : {}),
    assistantMessage: safeText(row.assistant_message),
    missingFields: parseJson<PlanningContextField[]>(row.missing_fields_json, []),
    toolCalls: parseJson<Array<{ toolName: string; input: Record<string, unknown> }>>(row.tool_calls_json, []),
    actionRequests: parseJson<Array<{ kind: string; resourceId: string }>>(row.action_requests_json, []),
    ...(row.plan_proposal_json ? { planProposal: parseJson<PlanProposalDraft | null>(row.plan_proposal_json, null) } : { planProposal: null }),
    ...(row.reasoning_summary ? { reasoningSummary: safeText(row.reasoning_summary) } : {}),
    toolCallSummaries: parseJson<ToolCallSummary[]>(row.tool_call_summaries_json, []),
    ...(row.next_step ? { nextStep: row.next_step } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class AgentRunRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(run: AgentRunSnapshot, userMessage = ''): Promise<void> {
    const row = serializeAgentRun({ ...run, userMessage: run.userMessage || userMessage });
    await this.db.insertInto('agent_runs').values(row).execute();
  }

  async get(runId: string): Promise<AgentRunSnapshot | null> {
    const row = await this.db.selectFrom('agent_runs').selectAll().where('id', '=', runId).executeTakeFirst();
    return row ? deserializeAgentRun(row) : null;
  }

  async save(run: AgentRunSnapshot): Promise<void> {
    const row = serializeAgentRun(run);
    await this.db.updateTable('agent_runs').set({
      conversation_id: row.conversation_id,
      trip_id: row.trip_id,
      actor_id: row.actor_id,
      status: row.status,
      user_message: row.user_message,
      current_trip_version: row.current_trip_version,
      assistant_message: row.assistant_message,
      missing_fields_json: row.missing_fields_json,
      tool_calls_json: row.tool_calls_json,
      tool_call_summaries_json: row.tool_call_summaries_json,
      action_requests_json: row.action_requests_json,
      planning_context_json: row.planning_context_json,
      reasoning_summary: row.reasoning_summary,
      plan_proposal_json: row.plan_proposal_json,
      next_step: row.next_step,
      request_id: row.request_id,
      correlation_id: row.correlation_id,
      updated_at: row.updated_at,
    }).where('id', '=', run.runId).execute();
  }

  update(run: AgentRunSnapshot): Promise<void> { return this.save(run); }

  async delete(runId: string): Promise<void> {
    await this.db.deleteFrom('agent_runs').where('id', '=', runId).execute();
  }

  async deleteConversation(conversationId: string): Promise<number> {
    const result = await this.db.deleteFrom('agent_runs').where('conversation_id', '=', conversationId).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }

  async deleteExpired(updatedBefore: string): Promise<number> {
    const result = await this.db.deleteFrom('agent_runs').where('updated_at', '<', updatedBefore).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
}
