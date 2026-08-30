import type { ItineraryItem } from '@travel/contracts';
export function ItineraryList({ items = [], warnings = [] }: { items?: ItineraryItem[]; warnings?: Array<{ message: string; severity: string }> }) {
  return <section aria-labelledby="itinerary-title" className="section-block"><div className="section-heading"><h2 id="itinerary-title">行程草案</h2><span className="muted">直接冲突会被阻止，节奏提醒仅供参考</span></div>{items.length ? <ol className="itinerary-list">{items.map(item => <li key={item.id}><strong>{item.category}</strong><span>{item.startsAt} - {item.endsAt}</span>{item.location && <span>{item.location.city}</span>}</li>)}</ol> : <p className="muted">还没有确认的行程项目。先比较选项，再决定加入计划。</p>}{warnings.map(warning => <p className="warning-line" key={warning.message}>提醒：{warning.message}</p>)}</section>;
}
