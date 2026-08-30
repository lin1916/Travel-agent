export function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = { completed: '已完成', running: '进行中', awaiting_input: '需要补充', failed: '失败', warning: '提醒', queued: '排队中' };
  return <span className={`status-badge status-${status}`} aria-label={`状态：${label[status] ?? status}`}>{label[status] ?? status}</span>;
}
