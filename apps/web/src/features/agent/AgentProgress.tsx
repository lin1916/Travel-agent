import { useMemo } from 'react';
import type { AgentRunStatus } from '@travel/contracts';
import type { AgentRunSummary } from '../../lib/api-client';

export interface AgentProgressEvent {
  type: string;
  payload?: Record<string, unknown>;
}

const labels: Record<string, string> = {
  AgentTurnStarted: '正在理解旅行需求',
  PlanningContextUpdated: '已更新旅行条件',
  ReasoningSummaryUpdated: '已整理规划依据',
  ToolCallStarted: '正在调用规划工具',
  ToolCallCompleted: '规划工具已完成',
  ToolCallFailed: '规划工具暂时不可用',
  PlanProposalCreated: '行程提案已准备好',
  AgentMessageCompleted: '本轮规划已完成',
  AgentTurnFailed: '本轮规划未完成',
};

const toolLabels: Record<string, string> = {
  search_places: '搜索地点',
  list_candidate_places: '读取候选地点',
  update_planning_context: '更新旅行条件',
  search_offers: '比较出行选项',
  add_itinerary_item: '加入行程草案',
  move_itinerary_item: '调整行程时间',
  remove_itinerary_item: '移除行程安排',
  replace_itinerary_item: '替换行程安排',
  lock_itinerary_item: '锁定行程安排',
  optimize_day: '优化当天节奏',
  check_schedule: '检查时间安排',
  calculate_budget: '计算预算',
};

function safeString(value: unknown, max = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .replace(/(?:authorization|cookie|api.?key|token|secret|raw|prompt|reasoning_content)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/authorization|cookie|api.?key|token|secret|raw|prompt|reasoning_content/gi, '[REDACTED]')
    .slice(0, max);
}

function eventText(event: AgentProgressEvent): string {
  const payload = event.payload ?? {};
  if (event.type === 'ReasoningSummaryUpdated') return safeString(payload.summary) ?? labels[event.type] ?? '规划进展已更新';
  if (event.type === 'ToolCallStarted' || event.type === 'ToolCallCompleted' || event.type === 'ToolCallFailed') {
    const toolName = safeString(payload.toolName, 80);
    const resultCount = typeof payload.resultCount === 'number' ? ` · ${payload.resultCount} 项结果` : '';
    return `${toolName ? toolLabels[toolName] ?? '规划工具' : '规划工具'}${resultCount}`;
  }
  return labels[event.type] ?? '规划进展已更新';
}

export function progressStatus(status?: AgentRunStatus, events: AgentProgressEvent[] = []): 'running' | 'completed' | 'failed' {
  if (status === 'failed' || events.at(-1)?.type === 'AgentTurnFailed') return 'failed';
  if (status === 'completed' || events.at(-1)?.type === 'AgentMessageCompleted') return 'completed';
  return 'running';
}

export function AgentProgress({ events, run }: { events: AgentProgressEvent[]; run?: AgentRunSummary }) {
  const status = progressStatus(run?.status, events);
  const visibleEvents = useMemo(() => events.slice(-8), [events]);
  if (!visibleEvents.length && !run) return null;
  const summary = [...visibleEvents].reverse().find(event => event.type === 'ReasoningSummaryUpdated');
  return <details className={`agent-progress agent-progress--${status}`} open={status === 'running'}>
    <summary><span className="agent-progress__status-dot" aria-hidden="true" /><span>{status === 'running' ? '正在规划' : status === 'completed' ? '规划已完成' : '本轮需要重试'}</span><span className="agent-progress__summary-label">查看思考与执行过程</span></summary>
    <div className="agent-progress__body">
      {summary && <p className="agent-progress__reasoning">{eventText(summary)}</p>}
      <ol className="agent-progress__events">
        {visibleEvents.map((event, index) => <li key={`${event.type}-${index}`}><span>{eventText(event)}</span><small>{labels[event.type] ?? '执行事件'}</small></li>)}
      </ol>
      {run?.missingFields?.length ? <p className="muted">仍需确认：{run.missingFields.join('、')}</p> : null}
    </div>
  </details>;
}
