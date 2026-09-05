import { FormEvent, useState } from 'react';
import type { Place } from '@travel/contracts';
import type { ApiClient } from '../../lib/api-client';

export function PlaceSearch({ conversationId, client, onResults, onAddCandidate }: {
  conversationId: string;
  client: ApiClient;
  onResults: (places: Place[]) => void;
  onAddCandidate: (place: Place) => Promise<void> | void;
}) {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await client.searchConversationPlaces(conversationId, value);
      setPlaces(result.places);
      onResults(result.places);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '地点搜索暂时不可用。');
      setPlaces([]);
      onResults([]);
    } finally {
      setBusy(false);
    }
  }

  return <section className="place-search section-block" aria-labelledby="place-search-title">
    <div className="section-heading"><div><span className="eyebrow">MAP SEARCH</span><h2 id="place-search-title">探索地点</h2></div><span className="muted">无需先创建行程</span></div>
    <form className="place-search__form" onSubmit={submit}>
      <label htmlFor="conversation-place-search">搜索景点、餐厅或酒店</label>
      <input id="conversation-place-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索景点、餐厅或酒店" />
      <button type="submit" aria-label="搜索地点" disabled={busy || !query.trim()}><span aria-hidden="true">⌕</span>{busy ? '搜索中' : '搜索'}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {places.length > 0 && <ul className="place-search__results" aria-label="地点搜索结果">
      {places.map(place => <li className="place-result" key={`${place.provider}:${place.providerPlaceId}`}>
        <div><strong>{place.name}</strong><span>{place.city} · {place.category}</span><small>{place.address}</small></div>
        <button type="button" className="icon-action" aria-label={`加入候选：${place.name}`} title="加入候选" onClick={() => void onAddCandidate(place)}><span aria-hidden="true">＋</span></button>
      </li>)}
    </ul>}
    {!busy && !error && query.trim() && !places.length && <p className="muted place-search__empty">没有找到可用地点。</p>}
  </section>;
}
