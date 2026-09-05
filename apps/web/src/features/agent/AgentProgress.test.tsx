import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentProgress, progressStatus } from './AgentProgress';

describe('AgentProgress', () => {
  it('renders safe status labels and redacts sensitive event text', () => {
    const html = renderToStaticMarkup(<AgentProgress events={[
      { type: 'ToolCallStarted', payload: { toolName: 'search_offers', authorization: 'Bearer secret-value' } },
      { type: 'ReasoningSummaryUpdated', payload: { summary: '已根据预算比较方案，token=private-summary-value' } },
    ]} />);
    expect(html).toContain('比较出行选项');
    expect(html).toContain('[REDACTED]');
    expect(html).not.toContain('secret-value');
    expect(html).not.toContain('private-summary-value');
    expect(html).not.toContain('authorization');
  });

  it('maps terminal progress events to stable states', () => {
    expect(progressStatus(undefined, [{ type: 'AgentTurnStarted' }])).toBe('running');
    expect(progressStatus(undefined, [{ type: 'AgentMessageCompleted' }])).toBe('completed');
    expect(progressStatus(undefined, [{ type: 'AgentTurnFailed' }])).toBe('failed');
  });
});
