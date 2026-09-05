import { randomUUID } from 'node:crypto';
import type { AgentRunStatus, PlanProposalDraft, PlanningContext, PlanningContextField, ToolCallSummary } from '@travel/contracts';

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
  planningContext: PlanningContext;
  /** Only allow-listed, redacted call descriptors are exposed; provider payloads are never returned. */
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
  missingFields: PlanningContextField[];
  actionRequests: Array<{ kind: string; resourceId: string }>;
  assistantMessage: string;
  reasoningSummary?: string;
  planProposal: PlanProposalDraft | null;
  toolCallSummaries: ToolCallSummary[];
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunPersistence {
  create(run: AgentRunSnapshot): Promise<AgentRunSnapshot | void> | AgentRunSnapshot | void;
  get(runId: string): Promise<AgentRunSnapshot | null | undefined> | AgentRunSnapshot | null | undefined;
  save(run: AgentRunSnapshot): Promise<AgentRunSnapshot | void> | AgentRunSnapshot | void;
  deleteConversation(conversationId: string): Promise<number> | number;
  delete?(runId: string): Promise<void> | void;
  deleteExpired?(updatedBefore: string): Promise<number> | number;
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

  constructor(private readonly now: () => Date = () => new Date()) {}

  create(input: Partial<Pick<AgentRunSnapshot, 'runId' | 'conversationId' | 'tripId' | 'actorId' | 'requestId' | 'correlationId' | 'userMessage' | 'currentTripVersion' | 'planningContext'>>): AgentRunSnapshot {
    const now = this.now().toISOString();
    const planningContext = input.planningContext ?? {
      conversationId: input.conversationId ?? '',
      version: 1,
      preferences: [],
      assumptions: [],
      missingFields: ['destination', 'startsAt', 'endsAt', 'travelerCount'],
      updatedAt: now,
    };
    const snapshot: AgentRunSnapshot = {
      runId: input.runId ?? randomUUID(), conversationId: input.conversationId, tripId: input.tripId, actorId: input.actorId, requestId: input.requestId, correlationId: input.correlationId,
      status: 'running', userMessage: input.userMessage ?? '', currentTripVersion: input.currentTripVersion ?? (input.tripId ? 1 : undefined),
      planningContext, assistantMessage: '', missingFields: [], toolCalls: [], actionRequests: [], planProposal: null,
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
    const updated = { ...run, updatedAt: this.now().toISOString() };
    this.runs.set(updated.runId, structuredClone(updated));
    return structuredClone(updated);
  }

  delete(runId: string): void { this.runs.delete(runId); }

  deleteConversation(conversationId: string): number {
    let deleted = 0;
    for (const [runId, run] of this.runs) {
      if (run.conversationId === conversationId) {
        this.runs.delete(runId);
        deleted += 1;
      }
    }
    return deleted;
  }

  deleteExpired(updatedBefore: string): number {
    let deleted = 0;
    for (const [runId, run] of this.runs) {
      if (run.updatedAt < updatedBefore) {
        this.runs.delete(runId);
        deleted += 1;
      }
    }
    return deleted;
  }
}

/** Small domain wrapper useful to callers that want an explicit AgentRun object. */
export class AgentRun {
  constructor(public readonly snapshot: AgentRunSnapshot) {}
  get runId(): string { return this.snapshot.runId; }
  get requestId(): string | undefined { return this.snapshot.requestId; }
  get correlationId(): string | undefined { return this.snapshot.correlationId; }
  get status(): AgentRunStatus { return this.snapshot.status; }
  toJSON(): AgentRunSnapshot { return structuredClone(this.snapshot); }
}
