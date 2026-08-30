import { randomUUID } from 'node:crypto';
import type { AgentRunStatus, ToolCallSummary } from '@travel/contracts';

export interface AgentRunSnapshot {
  runId: string;
  tripId: string;
  actorId?: string;
  status: AgentRunStatus;
  userMessage: string;
  currentTripVersion: number;
  /** Only allow-listed, redacted call descriptors are exposed; provider payloads are never returned. */
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
  missingFields: string[];
  actionRequests: Array<{ kind: string; resourceId: string }>;
  assistantMessage: string;
  toolCallSummaries: ToolCallSummary[];
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunPersistence {
  create(run: AgentRunSnapshot): Promise<AgentRunSnapshot | void> | AgentRunSnapshot | void;
  get(runId: string): Promise<AgentRunSnapshot | null | undefined> | AgentRunSnapshot | null | undefined;
  save(run: AgentRunSnapshot): Promise<AgentRunSnapshot | void> | AgentRunSnapshot | void;
}

export function redactUserMessage(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{17}[\dXx]\b/g, '[REDACTED_ID]')
    .replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{12,19}\b/g, '[REDACTED_PAYMENT]')
    .replace(/((?:passport|password|\u62a4\u7167|\u5bc6\u7801|\u8eab\u4efd\u8bc1)\s*[:\u53f7]?\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

export class AgentRunStore implements AgentRunPersistence {
  private readonly runs = new Map<string, AgentRunSnapshot>();

  create(input: Pick<AgentRunSnapshot, 'tripId' | 'actorId'> & Partial<Pick<AgentRunSnapshot, 'runId' | 'userMessage' | 'currentTripVersion'>>): AgentRunSnapshot {
    const now = new Date().toISOString();
    const snapshot: AgentRunSnapshot = {
      runId: input.runId ?? randomUUID(), tripId: input.tripId, actorId: input.actorId,
      status: 'running', userMessage: input.userMessage ?? '', currentTripVersion: input.currentTripVersion ?? 1,
      assistantMessage: '', missingFields: [], toolCalls: [], actionRequests: [],
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
