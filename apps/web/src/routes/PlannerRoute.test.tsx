import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlannerRoute } from './PlannerRoute';

describe('PlannerRoute', () => {
  it('renders a conversation-first chat and map search without a Trip form', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null });
    const html = renderToStaticMarkup(<PlannerRoute />);
    expect(html).toContain('Voyager Agent');
    expect(html).toContain('你的想法');
    expect(html).toContain('搜索地点');
    expect(html).not.toContain('精确编辑行程范围');
    expect(html).not.toContain('planner-form');
  });

  it('does not render a Trip, booking or payment surface on the bootstrap view', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null });
    const html = renderToStaticMarkup(<PlannerRoute />);
    expect(html).not.toContain('reference-itinerary-float');
    expect(html).not.toMatch(/预订|支付|下单|退款|证件/);
  });
});
