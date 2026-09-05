import type { ClientMessageId, Conversation, ConversationMessage, ConversationTurnEvent, PlanProposalDraft, PlanningContext, RiskLevel } from '@travel/contracts';
import { redactSensitiveText } from '@travel/contracts';
import { ApplicationError } from '../errors.js';

interface StoredConversation extends Conversation { sessionId: string }

export interface ConversationRepository {
  create(conversation: StoredConversation): Promise<void>;
  get(id: string): Promise<StoredConversation | undefined>;
  expiredBefore(timestamp: string): Promise<StoredConversation[]>;
  save(conversation: StoredConversation): Promise<void>;
  delete(id: string): Promise<void>;
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, StoredConversation>();

  async create(conversation: StoredConversation): Promise<void> { this.conversations.set(conversation.id, structuredClone(conversation)); }
  async get(id: string): Promise<StoredConversation | undefined> {
    const conversation = this.conversations.get(id);
    return conversation ? structuredClone(conversation) : undefined;
  }
  async expiredBefore(timestamp: string): Promise<StoredConversation[]> {
    return [...this.conversations.values()].filter(conversation => conversation.expiresAt <= timestamp).map(conversation => structuredClone(conversation));
  }
  async save(conversation: StoredConversation): Promise<void> { this.conversations.set(conversation.id, structuredClone(conversation)); }
  async delete(id: string): Promise<void> { this.conversations.delete(id); }
}

export interface ConversationTurnRunner {
  run(input: {
    actorId: string;
    conversationId: string;
    tripId?: string;
    planningContext?: PlanningContext;
    requestedRisk: RiskLevel;
    messages: Array<Pick<ConversationMessage, 'role' | 'content'>>;
    onEvent?(event: ConversationLifecycleEvent): Promise<void> | void;
  }): Promise<{ assistantMessage: string; agentRunId?: string; tripId?: string; planningContext?: PlanningContext; planProposal?: PlanProposalDraft | null; correlationId?: string }>;
}

export interface ConversationLifecycleEvent {
  type: ConversationTurnEvent['event_type'];
  runId?: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

export interface AgentRunLifecycle {
  deleteConversation?(conversationId: string): Promise<number> | number;
  delete?(runId: string): Promise<void> | void;
}

export interface ConversationDataLifecycle {
  deleteConversation?(sessionId: string, conversationId: string): Promise<void> | void;
  purgeConversation?(conversationId: string): Promise<void> | void;
}

export interface ConversationProposalWriter {
  create(sessionId: string, draft: PlanProposalDraft): Promise<unknown>;
}

export interface ConversationEventPublisher {
  publish(conversationId: string, input: {
    eventId?: string;
    type: ConversationTurnEvent['event_type'];
    runId?: string;
    occurredAt?: string;
    requestId?: string;
    correlationId: string;
    payload: Record<string, unknown>;
  }): Promise<ConversationTurnEvent> | ConversationTurnEvent;
  delete(conversationId: string): Promise<void> | void;
}

export interface CreateConversationInput { providerName: string; model: string; tripId?: string }
export interface AppendConversationMessageInput { content: string; clientMessageId: ClientMessageId }
export interface ConversationPlanningContextLifecycle {
  initialize(sessionId: string, conversationId: string): Promise<PlanningContext>;
  get(sessionId: string, conversationId: string): Promise<PlanningContext>;
  delete?(sessionId: string, conversationId: string): Promise<void>;
  purgeConversation?(conversationId: string): Promise<void>;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function sanitize(content: string): string {
  return redactSensitiveText(content);
}

function publicConversation(conversation: StoredConversation): Conversation {
  const { sessionId: _sessionId, ...value } = conversation;
  return structuredClone(value);
}

export class ConversationService {
  private readonly activeTurns = new Set<string>();
  private readonly pendingReplays = new Map<string, { content: string; promise: Promise<Conversation> }>();
  private readonly completedReplays = new Map<string, Conversation>();

  constructor(
    private readonly repository: ConversationRepository,
    private readonly runner: ConversationTurnRunner,
    private readonly clock: { now(): Date; id(): string } = { now: () => new Date(), id: () => crypto.randomUUID() },
    private readonly runs?: AgentRunLifecycle,
    private readonly events?: ConversationEventPublisher,
    private readonly planningContexts?: ConversationPlanningContextLifecycle,
    private readonly data?: ConversationDataLifecycle,
    private readonly proposals?: ConversationProposalWriter,
  ) {}

  async create(sessionId: string, input: CreateConversationInput): Promise<Conversation> {
    if (!sessionId || !input.providerName?.trim() || !input.model?.trim()) throw new ApplicationError('validation_error');
    const now = this.clock.now();
    const conversation: StoredConversation = {
      id: this.clock.id(), sessionId, providerName: sanitize(input.providerName), model: sanitize(input.model), status: 'active', messages: [],
      ...(input.tripId ? { tripId: sanitize(input.tripId) } : {}),
      createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + RETENTION_MS).toISOString(),
    };
    await this.repository.create(conversation);
    if (!this.planningContexts) return publicConversation(conversation);
    const planningContext = await this.planningContexts.initialize(sessionId, conversation.id);
    const initialized = { ...conversation, planningContext };
    await this.repository.save(initialized);
    return publicConversation(initialized);
  }

  async get(sessionId: string, id: string): Promise<Conversation> {
    const conversation = await this.owned(sessionId, id);
    const context = this.planningContexts ? await this.planningContexts.get(sessionId, id).catch(() => undefined) : undefined;
    return publicConversation({ ...conversation, ...(context ? { planningContext: context } : {}) });
  }

  async assertOwned(sessionId: string, id: string): Promise<void> {
    await this.owned(sessionId, id);
  }

  async appendUserMessage(sessionId: string, id: string, input: AppendConversationMessageInput): Promise<Conversation> {
    if (!input.content?.trim() || !input.clientMessageId) throw new ApplicationError('validation_error');
    const conversation = await this.owned(sessionId, id);
    const content = sanitize(input.content.trim());
    const replayKey = `${id}:${input.clientMessageId}`;
    const completedReplay = this.completedReplays.get(replayKey);
    if (completedReplay) {
      const original = completedReplay.messages.find(message => message.role === 'user' && message.clientMessageId === input.clientMessageId);
      if (original?.content !== content) throw new ApplicationError('conflict', 'client message ID was reused with different content');
      return structuredClone(completedReplay);
    }
    const pendingReplay = this.pendingReplays.get(replayKey);
    if (pendingReplay) {
      if (pendingReplay.content !== content) throw new ApplicationError('conflict', 'client message ID was reused with different content');
      return pendingReplay.promise;
    }
    const replay = conversation.messages.find(message => message.role === 'user' && message.clientMessageId === input.clientMessageId);
    if (replay) {
      if (replay.content !== content) throw new ApplicationError('conflict', 'client message ID was reused with different content');
      const replayIndex = conversation.messages.findIndex(message => message.id === replay.id);
      const hasAssistantReply = conversation.messages[replayIndex + 1]?.role === 'assistant';
      if (hasAssistantReply) return publicConversation(conversation);
    }
    if (this.activeTurns.has(id)) throw new ApplicationError('conflict', 'conversation_turn_in_progress');
    this.activeTurns.add(id);
    const turn = this.executeTurn(sessionId, conversation, input.clientMessageId, content);
    this.pendingReplays.set(replayKey, { content, promise: turn });
    try {
      const result = await turn;
      this.completedReplays.set(replayKey, structuredClone(result));
      return result;
    } finally {
      this.pendingReplays.delete(replayKey);
      this.activeTurns.delete(id);
    }
  }

  private async executeTurn(sessionId: string, conversation: StoredConversation, clientMessageId: ClientMessageId, content: string): Promise<Conversation> {
    const id = conversation.id;
    const now = this.clock.now().toISOString();
    const userMessage = conversation.messages.find(message => message.role === 'user' && message.clientMessageId === clientMessageId) ?? {
      id: this.clock.id(), clientMessageId, role: 'user' as const, content, createdAt: now,
    };
    const messages = conversation.messages.some(message => message.id === userMessage.id)
      ? [...conversation.messages]
      : [...conversation.messages, userMessage];
    if (!conversation.messages.some(message => message.id === userMessage.id)) {
      await this.repository.save({ ...conversation, messages, updatedAt: now });
      await this.publishMessage(conversation, userMessage);
    }
    let result: Awaited<ReturnType<ConversationTurnRunner['run']>>;
    let activeRunId: string | undefined;
    try {
      result = await this.runner.run({
        actorId: sessionId,
        conversationId: id,
        tripId: conversation.tripId,
        planningContext: this.planningContexts ? await this.planningContexts.get(sessionId, id) : conversation.planningContext,
        requestedRisk: 'prepare',
        messages: messages.map(({ role, content }) => ({ role, content })),
        onEvent: async event => {
          activeRunId = event.runId ?? activeRunId;
          await this.events?.publish(id, { type: event.type, runId: event.runId, correlationId: event.correlationId, payload: event.payload });
        },
      });
    } catch (error) {
      await this.repository.save({ ...conversation, status: 'failed', messages, ...(activeRunId ? { agentRunId: activeRunId } : {}), updatedAt: now });
      await this.events?.publish(id, { type: 'ConversationFailed', ...(activeRunId ? { runId: activeRunId } : {}), occurredAt: now, correlationId: activeRunId ?? id, payload: { retryable: true } });
      throw new ApplicationError('supplier_unavailable', error instanceof Error ? error.message : 'conversation turn failed');
    }
    const linked: StoredConversation = {
      ...conversation,
      status: 'active',
      messages,
      ...(result.agentRunId ? { agentRunId: result.agentRunId } : {}),
      ...(result.tripId ? { tripId: result.tripId } : {}),
      ...(result.planningContext ? { planningContext: result.planningContext } : {}),
      ...(this.planningContexts ? { planningContext: await this.planningContexts.get(sessionId, id).catch(() => result.planningContext) } : {}),
      updatedAt: this.clock.now().toISOString(),
    };
    await this.repository.save(linked);
    try {
      if (result.planProposal) await this.proposals?.create(sessionId, result.planProposal);
    } catch (error) {
      await this.repository.save({ ...linked, status: 'failed' });
      throw new ApplicationError('supplier_unavailable', error instanceof Error ? error.message : 'plan proposal persistence failed');
    }
    const assistantMessage: ConversationMessage = { id: this.clock.id(), role: 'assistant', content: sanitize(result.assistantMessage), createdAt: this.clock.now().toISOString() };
    const updated: StoredConversation = {
      ...linked,
      messages: [...messages, assistantMessage],
      updatedAt: assistantMessage.createdAt,
    };
    await this.repository.save(updated);
    await this.publishMessage(updated, assistantMessage, result.correlationId);
    return publicConversation(updated);
  }

  async delete(sessionId: string, id: string): Promise<void> {
    await this.purge(await this.owned(sessionId, id));
  }

  async purgeExpired(): Promise<number> {
    const expired = await this.repository.expiredBefore(this.clock.now().toISOString());
    for (const conversation of expired) await this.purge(conversation);
    return expired.length;
  }

  private async owned(sessionId: string, id: string): Promise<StoredConversation> {
    const conversation = await this.repository.get(id);
    if (!conversation) throw new ApplicationError('validation_error', 'conversation not found');
    if (conversation.sessionId !== sessionId) throw new ApplicationError('forbidden', 'conversation belongs to another session');
    if (Date.parse(conversation.expiresAt) <= this.clock.now().getTime()) {
      await this.purge(conversation);
      throw new ApplicationError('unauthorized', 'anonymous session expired');
    }
    return conversation;
  }

  private async purge(conversation: StoredConversation): Promise<void> {
    if (this.runs?.deleteConversation) await this.runs.deleteConversation(conversation.id);
    else if (conversation.agentRunId) await this.runs?.delete?.(conversation.agentRunId);
    if (this.data?.purgeConversation) await this.data.purgeConversation(conversation.id);
    else if (this.data?.deleteConversation) await this.data.deleteConversation(conversation.sessionId, conversation.id);
    if (this.planningContexts?.purgeConversation) await this.planningContexts.purgeConversation(conversation.id).catch(() => undefined);
    else if (this.planningContexts?.delete) await this.planningContexts.delete(conversation.sessionId, conversation.id).catch(() => undefined);
    await this.events?.delete(conversation.id);
    await this.repository.delete(conversation.id);
    for (const key of this.completedReplays.keys()) if (key.startsWith(`${conversation.id}:`)) this.completedReplays.delete(key);
  }

  private async publishMessage(conversation: StoredConversation, message: ConversationMessage, correlationId?: string): Promise<void> {
    await this.events?.publish(conversation.id, {
      eventId: message.id,
      type: 'ConversationMessageCreated',
      ...(conversation.agentRunId ? { runId: conversation.agentRunId } : {}),
      occurredAt: message.createdAt,
      requestId: message.id,
      correlationId: correlationId ?? conversation.agentRunId ?? conversation.id,
      payload: { message },
    });
  }
}
