import type { AgentRunSummary } from '../../lib/api-client';

export function PlanningDetailsDrawer({ run }: { run?: AgentRunSummary }) {
  return <details className="planning-details section-block"><summary>查看规划过程</summary>{run ? <div className="planning-details__content"><p>{run.assistantMessage}</p><dl className="activity-meta"><div><dt>状态</dt><dd>{run.status}</dd></div><div><dt>工具调用</dt><dd>{run.toolCallSummaries.length} 项</dd></div><div><dt>更新时间</dt><dd>{run.updatedAt}</dd></div></dl>{run.toolCallSummaries.map(item => <div className="activity-row" key={item.correlationId}><span>{item.toolName}</span><span>{item.resultSummary?.source ? String(item.resultSummary.source) : '已完成'}</span><span>{item.status}</span></div>)}</div> : <p className="muted">发送第一条消息后，这里会显示工具状态和执行摘要。</p>}</details>;
}
