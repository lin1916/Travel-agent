import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatPanel, buildAssistantMessage, retryMessage } from './ChatPanel';

describe('ChatPanel', () => {
  it('renders an initial planning prompt without booking or payment controls', () => {
    const html = renderToStaticMarkup(<ChatPanel />);
    expect(html).toContain('告诉我你想怎么旅行');
    expect(html).toContain('例如：10月去杭州玩4天，节奏轻松');
    expect(html).toContain('send-icon');
    expect(html).not.toMatch(/预订|支付|下单/);
  });

  it('shows pending and failed message states with retry affordance', () => {
    const html = renderToStaticMarkup(<ChatPanel initialMessages={[
      { id: 'u1', role: 'user', content: '去杭州', status: 'sent' },
      { id: 'a1', role: 'assistant', content: '正在整理', status: 'pending' },
      { id: 'a2', role: 'assistant', content: '暂时失败', status: 'failed' },
    ]} onSubmit={() => undefined} />);
    expect(html).toContain('正在整理');
    expect(html).toContain('重试本轮');
  });

  it('does not synthesize a successful assistant reply when the submit callback returns nothing', () => {
    const html = renderToStaticMarkup(<ChatPanel onSubmit={() => undefined} />);
    expect(html).not.toContain('已收到，我正在更新行程');
  });
  it('models a pending assistant response and uses the successful retry response', () => {
    const pending = buildAssistantMessage('m1', '正在生成');
    expect(pending).toMatchObject({ role: 'assistant', status: 'pending' });
    expect(retryMessage(pending, '已生成杭州方案')).toMatchObject({ content: '已生成杭州方案', status: 'sent' });
  });
});
