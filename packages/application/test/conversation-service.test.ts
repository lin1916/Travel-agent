import { describe, expect, it } from 'vitest';
import {
  ConversationService,
  InMemoryConversationRepository,
  type ConversationTurnRunner,
} from '../src/conversations/conversation-service.js';

const start = new Date('2026-09-02T10:00:00.000Z');
const messageIds = {
  first: '018f47f2-3a8a-7c71-9d2d-f114dfe66a01',
  second: '018f47f2-3a8a-7c71-9d2d-f114dfe66a02',
  third: '018f47f2-3a8a-7c71-9d2d-f114dfe66a03',
} as const;

function fixture() {
  let now = start;
  let nextId = 0;
  const repository = new InMemoryConversationRepository();
  const turns: Array<{ actorId: string; conversationId: string; tripId?: string; requestedRisk: string; messages: Array<{ role: string; content: string }> }> = [];
  const runner: ConversationTurnRunner = {
    run: async input => {
      turns.push({ actorId: input.actorId, conversationId: input.conversationId, tripId: input.tripId, requestedRisk: input.requestedRisk, messages: input.messages });
      return { assistantMessage: `Reply ${turns.length}`, agentRunId: `run-${turns.length}`, tripId: input.tripId };
    },
  };
  const deletedRuns: string[] = [];
  const service = new ConversationService(repository, runner, {
    now: () => now,
    id: () => `id-${++nextId}`,
  }, { delete: async runId => { deletedRuns.push(runId); } });
  return { repository, service, turns, deletedRuns, setNow: (value: string) => { now = new Date(value); } };
}

describe('ConversationService', () => {
  it('expires anonymous conversations seven days after creation', async () => {
    const { service, setNow } = fixture();
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });

    expect(created.expiresAt).toBe('2026-09-09T10:00:00.000Z');
    setNow('2026-09-09T10:00:00.001Z');

    await expect(service.get('session-a', created.id)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('does not reveal whether a conversation belongs to another session', async () => {
    const { service } = fixture();
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });

    await expect(service.get('session-b', created.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.appendUserMessage('session-b', created.id, { content: 'hello', clientMessageId: messageIds.first })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.delete('session-b', created.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('stores user and assistant messages in turn order and passes sanitized history to the runner', async () => {
    const { service, turns } = fixture();
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model', tripId: 'trip-1' });

    const first = await service.appendUserMessage('session-a', created.id, { content: 'Plan Hangzhou', clientMessageId: messageIds.first });
    const second = await service.appendUserMessage('session-a', created.id, { content: 'Make day two relaxed', clientMessageId: messageIds.second });

    expect(second.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Plan Hangzhou'],
      ['assistant', 'Reply 1'],
      ['user', 'Make day two relaxed'],
      ['assistant', 'Reply 2'],
    ]);
    expect(first.agentRunId).toBe('run-1');
    expect(second.agentRunId).toBe('run-2');
    expect(turns[1]?.messages.map(message => message.content)).toEqual(['Plan Hangzhou', 'Reply 1', 'Make day two relaxed']);
    expect(turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: 'session-a', conversationId: created.id, tripId: 'trip-1', requestedRisk: 'prepare' }),
    ]));
    expect(second.messages[0]).toMatchObject({ role: 'user', clientMessageId: messageIds.first });
    expect(second.messages[1]).not.toHaveProperty('clientMessageId');
  });

  it('deletes a conversation immediately', async () => {
    const { service, deletedRuns } = fixture();
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    const updated = await service.appendUserMessage('session-a', created.id, { content: 'hello', clientMessageId: messageIds.first });

    await service.delete('session-a', created.id);

    await expect(service.get('session-a', created.id)).rejects.toMatchObject({ code: 'validation_error' });
    expect(deletedRuns).toEqual([updated.agentRunId]);
  });

  it('redacts credentials, authorization values, and personal data before persistence', async () => {
    const { repository, service } = fixture();
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });

    await service.appendUserMessage('session-a', created.id, {
      content: 'authorization: Bearer top-secret api_key=sk-secret email me at guest@example.com or 13812345678',
      clientMessageId: messageIds.first,
    });

    const stored = JSON.stringify(await repository.get(created.id));
    expect(stored).not.toContain('top-secret');
    expect(stored).not.toContain('sk-secret');
    expect(stored).not.toContain('guest@example.com');
    expect(stored).not.toContain('13812345678');
    expect(stored).toContain('[REDACTED]');
  });

  it('persists a recoverable failed turn when the model runner is unavailable', async () => {
    const repository = new InMemoryConversationRepository();
    const service = new ConversationService(repository, { run: async () => { throw new Error('provider timeout'); } }, { now: () => start, id: () => 'id' });
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });

    await expect(service.appendUserMessage('session-a', created.id, { content: 'Plan Hangzhou', clientMessageId: messageIds.first })).rejects.toMatchObject({ code: 'supplier_unavailable' });

    const recovered = await service.get('session-a', created.id);
    expect(recovered.status).toBe('failed');
    expect(recovered.messages.map(message => [message.role, message.content])).toEqual([['user', 'Plan Hangzhou']]);
  });

  it('purges the associated agent run when a conversation expires', async () => {
    const { service, deletedRuns, setNow } = fixture();
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    const updated = await service.appendUserMessage('session-a', created.id, { content: 'hello', clientMessageId: messageIds.first });
    setNow('2026-09-09T10:00:00.001Z');

    await expect(service.get('session-a', created.id)).rejects.toMatchObject({ code: 'unauthorized' });

    expect(deletedRuns).toEqual([updated.agentRunId]);
  });

  it('retains the failed run reference so immediate deletion removes it', async () => {
    const repository = new InMemoryConversationRepository();
    const deletedRuns: string[] = [];
    const service = new ConversationService(repository, {
      run: async input => {
        await input.onEvent?.({ type: 'AgentRunFailed', runId: 'failed-run', correlationId: 'failed-correlation', payload: { retryable: true } });
        throw new Error('provider timeout');
      },
    }, { now: () => start, id: () => 'conversation-or-message' }, { delete: async runId => { deletedRuns.push(runId); } });
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    await expect(service.appendUserMessage('session-a', created.id, { content: 'Plan Hangzhou', clientMessageId: messageIds.first })).rejects.toMatchObject({ code: 'supplier_unavailable' });

    await service.delete('session-a', created.id);

    expect(deletedRuns).toEqual(['failed-run']);
  });

  it('globally purges expired conversations while preserving later conversations', async () => {
    const { repository, service, deletedRuns, setNow } = fixture();
    const early = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    const earlyTurn = await service.appendUserMessage('session-a', early.id, { content: 'early', clientMessageId: messageIds.first });
    setNow('2026-09-08T10:00:00.000Z');
    const later = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    const laterTurn = await service.appendUserMessage('session-a', later.id, { content: 'later', clientMessageId: messageIds.second });
    setNow('2026-09-10T10:00:00.000Z');

    const purged = await service.purgeExpired();

    expect(purged).toBe(1);
    expect(await repository.get(early.id)).toBeUndefined();
    expect(await repository.get(later.id)).toMatchObject({ id: later.id, expiresAt: '2026-09-15T10:00:00.000Z' });
    expect(deletedRuns).toEqual([earlyTurn.agentRunId]);
    expect(deletedRuns).not.toContain(laterTurn.agentRunId);
  });

  it('replays the saved turn for the same client message and rejects changed content', async () => {
    const { service, turns } = fixture();
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });

    const first = await service.appendUserMessage('session-a', created.id, { content: 'Plan Hangzhou', clientMessageId: messageIds.first });
    const replay = await service.appendUserMessage('session-a', created.id, { content: 'Plan Hangzhou', clientMessageId: messageIds.first });

    expect(replay).toEqual(first);
    expect(turns).toHaveLength(1);
    await expect(service.appendUserMessage('session-a', created.id, { content: 'Plan Suzhou', clientMessageId: messageIds.first }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(turns).toHaveLength(1);
  });

  it('returns the original saved turn when an earlier message is replayed after a later turn', async () => {
    const { service, turns } = fixture();
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    const first = await service.appendUserMessage('session-a', created.id, { content: 'first', clientMessageId: messageIds.first });
    await service.appendUserMessage('session-a', created.id, { content: 'second', clientMessageId: messageIds.second });

    const replay = await service.appendUserMessage('session-a', created.id, { content: 'first', clientMessageId: messageIds.first });

    expect(replay).toEqual(first);
    expect(turns).toHaveLength(2);
  });

  it('joins an in-flight duplicate message without starting another runner turn', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    let turnCount = 0;
    const repository = new InMemoryConversationRepository();
    const service = new ConversationService(repository, {
      run: async () => {
        turnCount += 1;
        started();
        await blocked;
        return { assistantMessage: 'done', agentRunId: 'run-1' };
      },
    }, { now: () => start, id: () => crypto.randomUUID() });
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    const first = service.appendUserMessage('session-a', created.id, { content: 'same', clientMessageId: messageIds.first });
    await running;
    const duplicate = service.appendUserMessage('session-a', created.id, { content: 'same', clientMessageId: messageIds.first });
    release();

    await expect(duplicate).resolves.toEqual(await first);
    expect(turnCount).toBe(1);
  });

  it('uses pending canonical content when the first message is not yet persisted', async () => {
    let releaseSave!: () => void;
    const saveBlocked = new Promise<void>(resolve => { releaseSave = resolve; });
    let saveStarted!: () => void;
    const saving = new Promise<void>(resolve => { saveStarted = resolve; });
    let stored: Parameters<InMemoryConversationRepository['create']>[0] | undefined;
    let turnCount = 0;
    const repository = {
      create: async (conversation: Parameters<InMemoryConversationRepository['create']>[0]) => { stored = structuredClone(conversation); },
      get: async () => stored ? structuredClone(stored) : undefined,
      expiredBefore: async () => [],
      save: async (conversation: Parameters<InMemoryConversationRepository['save']>[0]) => {
        if (conversation.messages.length === 1) {
          saveStarted();
          await saveBlocked;
        }
        stored = structuredClone(conversation);
      },
      delete: async () => { stored = undefined; },
    };
    const service = new ConversationService(repository, {
      run: async () => {
        turnCount += 1;
        return { assistantMessage: 'done', agentRunId: 'run-1' };
      },
    }, { now: () => start, id: () => crypto.randomUUID() });
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    const first = service.appendUserMessage('session-a', created.id, { content: 'same', clientMessageId: messageIds.first });
    await saving;

    await expect(service.appendUserMessage('session-a', created.id, { content: 'different', clientMessageId: messageIds.first }))
      .rejects.toMatchObject({ code: 'conflict' });
    const duplicate = service.appendUserMessage('session-a', created.id, { content: 'same', clientMessageId: messageIds.first });
    releaseSave();

    await expect(duplicate).resolves.toEqual(await first);
    expect(turnCount).toBe(1);
  });

  it('rejects overlapping distinct turns for one conversation', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const repository = new InMemoryConversationRepository();
    const service = new ConversationService(repository, {
      run: async () => {
        started();
        await blocked;
        return { assistantMessage: 'done', agentRunId: 'run-1' };
      },
    }, { now: () => start, id: () => crypto.randomUUID() });
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    const first = service.appendUserMessage('session-a', created.id, { content: 'first', clientMessageId: messageIds.first });
    await running;

    await expect(service.appendUserMessage('session-a', created.id, { content: 'second', clientMessageId: messageIds.second }))
      .rejects.toMatchObject({ code: 'conflict', detail: { internalDetail: 'conversation_turn_in_progress' } });
    release();
    await first;
  });

  it('keeps a proposal persistence failure retryable with the same client message ID', async () => {
    const repository = new InMemoryConversationRepository();
    let turns = 0;
    let proposalWrites = 0;
    const service = new ConversationService(
      repository,
      {
        run: async () => ({
          assistantMessage: 'proposal ready',
          agentRunId: `run-${++turns}`,
          tripId: 'trip-1',
          planProposal: { conversationId: 'conversation-1' } as never,
        }),
      },
      { now: () => start, id: (() => { let id = 0; return () => `id-${++id}`; })() },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        create: async () => {
          proposalWrites += 1;
          if (proposalWrites === 1) throw new Error('proposal store unavailable');
        },
      },
    );
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });

    await expect(service.appendUserMessage('session-a', created.id, { content: 'make a proposal', clientMessageId: messageIds.first }))
      .rejects.toMatchObject({ code: 'supplier_unavailable' });
    await expect(service.get('session-a', created.id)).resolves.toMatchObject({
      status: 'failed', tripId: 'trip-1', agentRunId: 'run-1', messages: [{ role: 'user', clientMessageId: messageIds.first }],
    });

    const recovered = await service.appendUserMessage('session-a', created.id, { content: 'make a proposal', clientMessageId: messageIds.first });
    expect(recovered).toMatchObject({ status: 'active', tripId: 'trip-1', agentRunId: 'run-2' });
    expect(recovered.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(turns).toBe(2);
    expect(proposalWrites).toBe(2);
  });

  it('deletes every historical agent run for the conversation', async () => {
    const repository = new InMemoryConversationRepository();
    const deletedConversations: string[] = [];
    let turn = 0;
    const service = new ConversationService(repository, {
      run: async () => ({ assistantMessage: 'ok', agentRunId: `run-${++turn}` }),
    }, { now: () => start, id: () => crypto.randomUUID() }, {
      deleteConversation: async conversationId => { deletedConversations.push(conversationId); return 2; },
    });
    const created = await service.create('session-a', { providerName: 'test-provider', model: 'test-model' });
    await service.appendUserMessage('session-a', created.id, { content: 'first', clientMessageId: messageIds.first });
    await service.appendUserMessage('session-a', created.id, { content: 'second', clientMessageId: messageIds.second });

    await service.delete('session-a', created.id);

    expect(deletedConversations).toEqual([created.id]);
  });
});
