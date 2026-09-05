import type { PlanningContext } from '@travel/contracts';

function dateLabel(value: string): string {
  const match = value.slice(5, 10).split('-');
  return match.length === 2 ? `${Number(match[0])}月${Number(match[1])}日` : value;
}

export function planningContextLabels(context?: PlanningContext): string[] {
  if (!context) return [];
  const labels: string[] = [];
  if (context.destination) labels.push(context.destination);
  if (context.startsAt && context.endsAt) labels.push(`${dateLabel(context.startsAt)}–${dateLabel(context.endsAt)}`);
  else if (context.startsAt) labels.push(`${dateLabel(context.startsAt)}起`);
  if (context.travelerCount) labels.push(`${context.travelerCount} 人`);
  if (context.totalBudgetCents !== undefined) labels.push(`预算 ¥${(context.totalBudgetCents / 100).toFixed(0)}`);
  return labels;
}

export function PlanningContextChips({ context, onSelect }: { context?: PlanningContext; onSelect?: (label: string) => void }) {
  const labels = planningContextLabels(context);
  if (!labels.length) return null;
  return <div className="planning-context-chips" aria-label="已识别的旅行条件">
    {labels.map(label => <button type="button" className="context-chip" key={label} onClick={() => onSelect?.(label)}>{label}</button>)}
  </div>;
}
