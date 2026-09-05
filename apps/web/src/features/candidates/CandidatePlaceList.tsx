import type { CandidatePlace } from '@travel/contracts';
import type { ApiClient } from '../../lib/api-client';

export function CandidatePlaceList({ conversationId, candidates, client, onChange }: {
  conversationId: string;
  candidates: CandidatePlace[];
  client: ApiClient;
  onChange: () => Promise<void> | void;
}) {
  async function remove(candidate: CandidatePlace) {
    await client.removeCandidate(conversationId, candidate.id);
    await onChange();
  }

  async function setPriority(candidate: CandidatePlace) {
    await client.updateCandidate(conversationId, candidate.id, { priority: candidate.priority === 0 ? 1 : 0 });
    await onChange();
  }

  return <section className="candidate-list section-block" aria-labelledby="candidate-list-title">
    <div className="section-heading"><div><span className="eyebrow">SAVED PLACES</span><h2 id="candidate-list-title">候选地点</h2></div><span className="muted">{candidates.length} 个</span></div>
    {candidates.length ? <ul>
      {candidates.map(candidate => <li className="candidate-item" key={candidate.id}>
        <div><strong>{candidate.place.name}</strong><span>{candidate.place.city} · {candidate.place.category}</span><small>{candidate.place.address}</small></div>
        <button type="button" className={`icon-action icon-action--quiet ${candidate.priority === 0 ? 'is-active' : ''}`} aria-label={candidate.priority === 0 ? `取消优先：${candidate.place.name}` : `置顶候选：${candidate.place.name}`} title={candidate.priority === 0 ? '取消优先' : '置顶候选'} onClick={() => void setPriority(candidate)}><span aria-hidden="true">★</span></button><button type="button" className="icon-action icon-action--quiet" aria-label={`移除候选：${candidate.place.name}`} title="移除候选" onClick={() => void remove(candidate)}><span aria-hidden="true">×</span></button>
      </li>)}
    </ul> : <p className="muted">搜索结果加入后会出现在这里，供后续提案参考。</p>}
  </section>;
}
