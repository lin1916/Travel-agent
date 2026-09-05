import type { NormalizedOffer, RankedOffer, OfferKind } from '@travel/contracts';
import { StatusBadge } from '../common/StatusBadge';

const kindLabels: Record<OfferKind, string> = { train: '火车', flight: '航班', stay: '住宿', attraction: '景点', dining: '餐饮' };
export function OfferComparison({ offers, ranked, categories }: { offers: Partial<Record<OfferKind, NormalizedOffer[]>>; ranked: Partial<Record<OfferKind, RankedOffer[]>>; categories: Partial<Record<OfferKind, { source?: string; updatedAt?: string; warning?: string; retryable: boolean }>> }) {
  const isRanked = (offer: NormalizedOffer | RankedOffer): offer is RankedOffer => 'factorContributions' in offer;
  return <section aria-labelledby="offers-title" className="section-block"><div className="section-heading"><h2 id="offers-title">精选选项</h2><span className="muted">按价格、耗时、便利度综合排序</span></div><div className="offer-grid">
    {(Object.keys(offers) as OfferKind[]).flatMap(kind => (ranked[kind] ?? offers[kind] ?? []).slice(0, 3).map((offer, index) => <article className="offer-card" data-testid="offer-card" key={`${kind}-${offer.id}`}><div className="offer-card__top"><span className="eyebrow">{kindLabels[kind]}</span>{index === 0 && <StatusBadge status="completed" />}</div><h3>{offer.title}</h3><p className="price">¥{(offer.price.amountCents / 100).toFixed(0)} <small>{offer.price.currency}</small></p>{isRanked(offer) && <div className="factor-list">{Object.entries(offer.factorContributions).slice(0, 3).map(([factor, value]) => <span key={factor}>{factor}: {(value * 100).toFixed(0)}%</span>)}</div>}<footer>来源：{offer.source} · 更新于 {offer.updatedAt}</footer></article>))}
    {Object.entries(categories).filter(([, category]) => category?.warning).map(([kind, category]) => <article className="offer-card offer-card--warning" key={`warning-${kind}`}><h3>{kindLabels[kind as OfferKind]}暂不可用</h3><p>{category?.warning}</p><StatusBadge status="warning" /></article>)}
  </div></section>;
}
