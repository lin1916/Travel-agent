import { randomUUID } from 'node:crypto';
import type { AgentRunStatus, ToolCallSummary, StructuredAgentOutput } from '@travel/contracts';

export interface AgentRunSnapshot extends StructuredAgentOutput {
  runId: string;
  tripId: string;
  actorId?: string;
  status: AgentRunStatus;
  toolCallSummaries: ToolCallSummary[];
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export class AgentRunStore {
  private readonly runs = new Map<string, AgentRunSnapshot>();

  create(input: Pick<AgentRunSnapshot, 'tripId' | 'actorId'> & Partial<Pick<AgentRunSnapshot, 'runId'>>): AgentRunSnapshot {
    const now = new Date().toISOString();
    const snapshot: AgentRunSnapshot = {
      runId: input.runId ?? randomUUID(), tripId: input.tripId, actorId: input.actorId,
      status: 'running', assistantMessage: '', missingFields: [], toolCalls: [], actionRequests: [],
      toolCallSummaries: [], createdAt: now, updatedAt: now,
    };
    this.runs.set(snapshot.runId, snapshot);
    return structuredClone(snapshot);
  }

  get(runId: string): AgentRunSnapshot | undefined {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  save(run: AgentRunSnapshot): AgentRunSnapshot {
    const updated = { ...run, updatedAt: new Date().toISOString() };
    this.runs.set(updated.runId, structuredClone(updated));
    return structuredClone(updated);
  }
}

/** Small domain wrapper useful to callers that want an explicit AgentRun object. */
export class AgentRun {
  constructor(public readonly snapshot: AgentRunSnapshot) {}
  get runId(): string { return this.snapshot.runId; }
  get status(): AgentRunStatus { return this.snapshot.status; }
  toJSON(): AgentRunSnapshot { return structuredClone(this.snapshot); }
}
