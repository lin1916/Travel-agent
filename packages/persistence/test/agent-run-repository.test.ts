import { describe, expect, it } from 'vitest';
import { deserializeAgentRun, serializeAgentRun, type AgentRunSnapshot } from '../src/repositories/agent-run-repository.js';

describe('AgentRunRepository serialization', () => {
  it('round-trips both request and correlation IDs', () => {
    const run = {
      runId: 'run-ids',
      tripId: 'trip-1',
      actorId: 'actor-1',
      requestId: 'request-1',
      correlationId: 'correlation-1',
      status: 'running',
      userMessage: '',
      currentTripVersion: 1,
      assistantMessage: '',
      missingFields: [],
      toolCalls: [],
      actionRequests: [],
      toolCallSummaries: [],
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    } as any;

    expect(deserializeAgentRun(serializeAgentRun(run))).toMatchObject({
      requestId: 'request-1',
      correlationId: 'correlation-1',
    });
  });

  it('round-trips tool calls, summaries, next step, user message, and trip version', () => {
    const run: AgentRunSnapshot = {
      runId: 'run-1', tripId: 'trip-1', actorId: 'actor-1', status: 'awaiting_input', userMessage: 'plan [REDACTED_PHONE]', currentTripVersion: 7,
      conversationId: 'conversation-1',
      planningContext: { conversationId: 'conversation-1', version: 2, destination: '杭州', preferences: [], assumptions: [], missingFields: ['endsAt'], updatedAt: '2026-08-30T00:01:00.000Z' },
      planProposal: null,
      assistantMessage: 'Choose an option', missingFields: ['endsAt'], toolCalls: [], actionRequests: [{ kind: 'confirmation_required', resourceId: 'trip-1' }],
      toolCallSummaries: [{ toolName: 'search_offers', risk: 'read', status: 'completed', inputSummary: { kind: 'train' }, resultSummary: { source: 'mock' }, correlationId: 'corr-1' }],
      nextStep: 'request_missing_fields', createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:01:00.000Z',
    };
    expect(deserializeAgentRun(serializeAgentRun(run))).toEqual(run);
  });
});
