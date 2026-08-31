import type { AgentRunStatus, ToolCallSummary } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../types.js';

export interface AgentRunSnapshot {
  runId: string;
  tripId: string;
  actorId?: string;
  correlationId?: string;
  status: AgentRunStatus;
  userMessage: string;
  currentTripVersion: number;
  assistantMessage: string;
  missingFields: string[];
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
  actionRequests: Array<{ kind: string; resourceId: string }>;
  toolCallSummaries: ToolCallSummary[];
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunSerialized {
  id: string; trip_id: string; actor_id: string | null; status: string; user_message: string; assistant_message: string;
  missing_fields_json: string; tool_calls_json: string; tool_call_summaries_json: string; action_requests_json: string;
  correlation_id: string | null;
  next_step: string | null; current_trip_version: number; created_at: string; updated_at: string;
}

export function serializeAgentRun(run: AgentRunSnapshot): AgentRunSerialized {
  return {
    id: run.runId, trip_id: run.tripId, actor_id: run.actorId ?? null, status: run.status,
    user_message: run.userMessage, assistant_message: run.assistantMessage, missing_fields_json: JSON.stringify(run.missingFields),
    tool_calls_json: JSON.stringify(run.toolCalls), tool_call_summaries_json: JSON.stringify(run.toolCallSummaries),
    action_requests_json: JSON.stringify(run.actionRequests), next_step: run.nextStep ?? null,
    current_trip_version: run.currentTripVersion, correlation_id: run.correlationId ?? null, created_at: run.createdAt, updated_at: run.updatedAt,
  };
}

export function deserializeAgentRun(row: AgentRunSerialized): AgentRunSnapshot {
  return {
    runId: row.id, tripId: row.trip_id, actorId: row.actor_id ?? undefined, correlationId: row.correlation_id ?? undefined, status: row.status as AgentRunSnapshot['status'],
    userMessage: row.user_message, currentTripVersion: row.current_trip_version, assistantMessage: row.assistant_message,
    missingFields: JSON.parse(row.missing_fields_json), toolCalls: JSON.parse(row.tool_calls_json),
    actionRequests: JSON.parse(row.action_requests_json), toolCallSummaries: JSON.parse(row.tool_call_summaries_json),
    nextStep: row.next_step ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
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
    if (!row) return null;
    return deserializeAgentRun(row);
  }

  async save(run: AgentRunSnapshot): Promise<void> {
    await this.db.updateTable('agent_runs').set({
      status: run.status, user_message: run.userMessage, current_trip_version: run.currentTripVersion,
      assistant_message: run.assistantMessage, missing_fields_json: JSON.stringify(run.missingFields),
      tool_calls_json: JSON.stringify(run.toolCalls), tool_call_summaries_json: JSON.stringify(run.toolCallSummaries), action_requests_json: JSON.stringify(run.actionRequests), next_step: run.nextStep ?? null,
      correlation_id: run.correlationId ?? null,
      updated_at: run.updatedAt,
    }).where('id', '=', run.runId).execute();
  }

  update(run: AgentRunSnapshot): Promise<void> { return this.save(run); }
}
