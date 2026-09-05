import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Conversation } from '@travel/contracts';
import { ConversationWorkspace } from './ConversationWorkspace';
import { ApiClient } from '../../lib/api-client';

const conversation: Conversation = {
  id: 'conversation-1',
  providerName: 'fixture',
  model: 'fixture',
  status: 'active',
  messages: [],
  planningContext: {
    conversationId: 'conversation-1',
    version: 3,
    destination: '杭州',
    startsAt: '2026-10-01T00:00:00+08:00',
    endsAt: '2026-10-04T00:00:00+08:00',
    travelerCount: 2,
    totalBudgetCents: 500_000,
    preferences: [],
    assumptions: [],
    missingFields: [],
    updatedAt: '2026-09-03T00:00:00.000Z',
  },
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  expiresAt: '2026-09-10T00:00:00.000Z',
};

describe('ConversationWorkspace', () => {
  it('renders context chips and an enabled pre-Trip map search without formal plan panels', () => {
    const html = renderToStaticMarkup(<ConversationWorkspace initialConversation={conversation} client={new ApiClient('/api')} />);
    expect(html).toContain('杭州');
    expect(html).toContain('10月1日–10月4日');
    expect(html).toContain('2 人');
    expect(html).toContain('预算 ¥5000');
    expect(html).toContain('探索地点');
    expect(html).toContain('搜索景点、餐厅或酒店');
    expect(html).not.toContain('行程时间线');
    expect(html).not.toContain('预算面板');
    expect(html).not.toMatch(/预订|支付|下单|退款|证件/);
  });
});
