import type { AgentRunStatus, ToolCallSummary } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../types.js';

export interface AgentRunSnapshot {
  runId: string;
  tripId: string;
  actorId?: string;
  status: AgentRunStatus;
  assistantMessage: string;
  missingFields: string[];
  toolCalls: Array<{ toolName: string; input: unknown }>;
  actionRequests: Array<{ kind: string; resourceId: string }>;
  toolCallSummaries: ToolCallSummary[];
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export class AgentRunRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(run: AgentRunSnapshot, userMessage = ''): Promise<void> {
    await this.db.insertInto('agent_runs').values({
      id: run.runId,
      trip_id: run.tripId,
      actor_id: run.actorId ?? null,
      status: run.status,
      user_message: userMessage,
      assistant_message: run.assistantMessage,
      missing_fields_json: JSON.stringify(run.missingFields),
      tool_calls_json: JSON.stringify(run.toolCallSummaries),
      action_requests_json: JSON.stringify(run.actionRequests),
      next_step: run.nextStep ?? null,
      current_trip_version: 1,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
    }).execute();
  }

  async get(runId: string): Promise<AgentRunSnapshot | null> {
    const row = await this.db.selectFrom('agent_runs').selectAll().where('id', '=', runId).executeTakeFirst();
    if (!row) return null;
    return {
      runId: row.id, tripId: row.trip_id, actorId: row.actor_id ?? undefined, status: row.status as AgentRunSnapshot['status'],
      assistantMessage: row.assistant_message, missingFields: JSON.parse(row.missing_fields_json), toolCalls: [],
      actionRequests: JSON.parse(row.action_requests_json), toolCallSummaries: JSON.parse(row.tool_calls_json), nextStep: row.next_step ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async update(run: AgentRunSnapshot): Promise<void> {
    await this.db.updateTable('agent_runs').set({
      status: run.status, assistant_message: run.assistantMessage, missing_fields_json: JSON.stringify(run.missingFields),
      tool_calls_json: JSON.stringify(run.toolCallSummaries), action_requests_json: JSON.stringify(run.actionRequests), next_step: run.nextStep ?? null,
      updated_at: run.updatedAt,
    }).where('id', '=', run.runId).execute();
  }
}
