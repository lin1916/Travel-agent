import type { PlanningBudgetSummary } from '@travel/contracts';
export function PlanBudget({ budget, fallbackTotalCents = 0 }: { budget?: PlanningBudgetSummary; fallbackTotalCents?: number }) {
  const limit = budget?.limit.amountCents ?? 0;
  const estimated = budget?.estimatedTotal.amountCents ?? fallbackTotalCents;
  const percent = limit ? Math.round(estimated / limit * 100) : 0;
  return <section className="section-block budget-panel" aria-labelledby="plan-budget-title"><div className="section-heading"><h2 id="plan-budget-title">预算面板</h2><span className="muted">动态估算</span></div><div className="budget-value"><strong>¥{(estimated / 100).toFixed(0)}</strong><span>{limit ? `/ ¥${(limit / 100).toFixed(0)}` : '尚未设置上限'}</span></div><div className="meter" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(percent, 100)}%` }} /></div><p className="muted">{limit ? `已使用 ${percent}%` : '添加预算后可获得超支提醒'}</p>{budget?.warnings.map(warning => <p className="warning-line" key={warning}>{warning === 'budget_exceeded' ? '已超过预算上限' : '已达到预算提醒阈值'}</p>)}</section>;
}
