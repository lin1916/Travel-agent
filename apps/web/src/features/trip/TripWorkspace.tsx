import type { NormalizedOffer, RankedOffer, OfferKind, ItineraryItem } from '@travel/contracts';
import type { AgentRunSummary } from '../../lib/api-client';
import { AgentActivityPanel } from '../agent/AgentActivityPanel';
import { OfferComparison } from '../search/OfferComparison';
import { ItineraryList } from '../itinerary/ItineraryList';
import { BudgetSummary } from '../budget/BudgetSummary';
export interface WorkspaceData { destination: string; tripId: string; offers: Partial<Record<OfferKind, NormalizedOffer[]>>; ranked: Partial<Record<OfferKind, RankedOffer[]>>; categories: Record<string, { source?: string; updatedAt?: string; warning?: string; retryable: boolean }>; run?: AgentRunSummary; itinerary?: { items: ItineraryItem[]; warnings: Array<{ message: string; severity: string }> }; totalBudgetCents?: number }
export function TripWorkspace({ data }: { data: WorkspaceData }) {
  const estimated = Object.values(data.offers).flat().reduce((sum, offer) => sum + (offer?.price.amountCents ?? 0), 0);
  return <main className="workspace" aria-labelledby="workspace-title"><header className="workspace-header"><div><span className="eyebrow">匿名规划 · 国内行程</span><h1 id="workspace-title">{data.destination}行程工作台</h1><p className="muted">信息仅用于本次规划；Agent 输出为摘要，敏感字段不会出现在浏览器存储中。</p></div><span className="privacy-note">隐私边界：规划可匿名，保存与预订需登录</span></header><div className="workspace-grid"><div className="workspace-main"><AgentActivityPanel run={data.run} /><OfferComparison offers={data.offers} ranked={data.ranked} categories={data.categories as never} /><ItineraryList items={data.itinerary?.items} warnings={data.itinerary?.warnings} /></div><aside className="workspace-aside"><BudgetSummary totalBudgetCents={data.totalBudgetCents} estimatedCents={estimated} /><section className="section-block"><h2>需要你决定</h2><ul className="plain-list"><li>价格与灵活退改的取舍</li><li>是否接受直飞或高铁方案</li><li>超过预算阈值时是否调整计划</li></ul></section></aside></div><nav className="bottom-nav" aria-label="工作台导航"><a href="#offers-title">选项</a><a href="#itinerary-title">行程</a><a href="#budget-title">预算</a></nav></main>;
}
