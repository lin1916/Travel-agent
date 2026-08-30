import { FormEvent, useState } from 'react';
import { ApiClient, PublicApiError, type SearchResult, type AgentRunSummary } from '../lib/api-client';
import type { OfferKind } from '@travel/contracts';
import { TripWorkspace, type WorkspaceData } from '../features/trip/TripWorkspace';
const client = new ApiClient();
const actorId = `anonymous-${crypto.randomUUID()}`;
const categories: OfferKind[] = ['train', 'stay', 'attraction', 'dining'];
export function PlannerRoute() {
  const [workspace, setWorkspace] = useState<WorkspaceData>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoading(true);
    const form = new FormData(event.currentTarget);
    const destination = String(form.get('destination') ?? '').trim();
    const startsAt = `${form.get('startsAt')}T00:00:00.000+08:00`;
    const endsAt = `${form.get('endsAt')}T00:00:00.000+08:00`;
    const travelers = Number(form.get('travelers') ?? 1);
    const totalBudgetCents = Number(form.get('budget') ?? 0) * 100;
    try {
      const trip = await client.createTrip({ destination, startsAt, endsAt, travelerCount: travelers, totalBudgetCents: totalBudgetCents || undefined }, actorId);
      const results = await Promise.allSettled(categories.map(kind => client.search(trip.id, { kind, startsAt, endsAt, travelers }, actorId)));
      const offers: WorkspaceData['offers'] = {}; const ranked: WorkspaceData['ranked'] = {}; const categoryInfo: WorkspaceData['categories'] = {};
      results.forEach((result, index) => { const kind = categories[index]; if (result.status === 'fulfilled') { const value: SearchResult = result.value; offers[kind] = value.offers[kind] ?? []; ranked[kind] = value.ranked[kind] ?? []; categoryInfo[kind] = value.categories[kind] ?? { retryable: false }; } else { categoryInfo[kind] = { warning: result.reason instanceof Error ? result.reason.message : '暂时无法获取', retryable: true }; } });
      let run: AgentRunSummary | undefined;
      try { run = await client.startAgent({ tripId: trip.id, userMessage: `计划去${destination}，${form.get('startsAt')}到${form.get('endsAt')}，${travelers}人` }); } catch (agentError) { if (agentError instanceof PublicApiError) setError(agentError.message); }
      setWorkspace({ destination, tripId: trip.id, offers, ranked, categories: categoryInfo, run, totalBudgetCents });
    } catch (requestError) { setError(requestError instanceof PublicApiError ? requestError.message : '暂时无法开始规划，请稍后重试。'); } finally { setLoading(false); }
  }
  if (workspace) return <TripWorkspace data={workspace} />;
  return <main className="planner-shell"><section className="planner-intro"><span className="eyebrow">TRAVEL AGENT · PLANNING</span><h1>把下一段国内旅程，先想清楚。</h1><p>输入目的地和日期，获得可比较的交通、住宿、景点与餐饮建议。规划过程可匿名进行。</p></section><form className="planner-form" onSubmit={submit}><h2>开始规划</h2><label>目的地<input name="destination" aria-label="目的地" required placeholder="例如：杭州" /></label><div className="form-row"><label>出发日期<input name="startsAt" aria-label="出发日期" type="date" required /></label><label>返程日期<input name="endsAt" aria-label="返程日期" type="date" required /></label></div><div className="form-row"><label>出行人数<input name="travelers" aria-label="出行人数" type="number" min="1" max="6" defaultValue="2" required /></label><label>预算上限（元）<input name="budget" type="number" min="0" step="100" placeholder="可选" /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" disabled={loading}>{loading ? '正在整理选项…' : '开始规划'}</button><p className="form-footnote">不会把旅客姓名、证件、支付或预订信息写入 localStorage。</p></form></main>;
}
