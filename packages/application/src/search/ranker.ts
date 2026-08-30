import type { NormalizedOffer, RankedOffer, RankingMode } from '@travel/contracts';

function range(values: number[], value: number, invert = false): number {
  if (values.length < 2 || Math.max(...values) === Math.min(...values)) return 1;
  const normalized = (value - Math.min(...values)) / (Math.max(...values) - Math.min(...values));
  return invert ? 1 - normalized : normalized;
}

export function rankOffers(offers: ReadonlyArray<NormalizedOffer>, mode: RankingMode): RankedOffer[] {
  const prices = offers.map(offer => offer.price.amountCents);
  const durations = offers.map(offer => offer.totalMinutes ?? 0);
  const transfers = offers.map(offer => offer.transferCount ?? 0);
  const scored = offers.map(offer => {
    const factors = { price: range(prices, offer.price.amountCents, true), totalMinutes: range(durations, offer.totalMinutes ?? 0, true), transfers: range(transfers, offer.transferCount ?? 0, true), location: offer.locationScore ?? 0, rating: (offer.rating ?? 0) / 5, refundFlexibility: offer.refundFlexibility ?? 0 };
    const weights = mode === 'cheapest' ? { price: 0.7, totalMinutes: 0.1, transfers: 0.05, location: 0.05, rating: 0.05, refundFlexibility: 0.05 } : mode === 'fastest' ? { price: 0.1, totalMinutes: 0.65, transfers: 0.15, location: 0.04, rating: 0.03, refundFlexibility: 0.03 } : mode === 'comfortable' ? { price: 0.1, totalMinutes: 0.1, transfers: 0.1, location: 0.2, rating: 0.25, refundFlexibility: 0.25 } : { price: 0.3, totalMinutes: 0.2, transfers: 0.1, location: 0.12, rating: 0.13, refundFlexibility: 0.15 };
    const factorContributions = Object.fromEntries(Object.entries(factors).map(([key, value]) => [key, value * weights[key as keyof typeof weights]]));
    const labels: Record<string, string> = { price: '价格有优势', totalMinutes: '行程耗时较短', transfers: '中转次数较少', location: '位置更便利', rating: '评分较高', refundFlexibility: '退改更灵活' };
    const reasons = Object.entries(factorContributions).sort(([, left], [, right]) => right - left).slice(0, 3).map(([key]) => labels[key]);
    return { ...offer, factorContributions, reasons };
  });
  return scored.sort((left, right) => {
    const leftScore = Object.values(left.factorContributions).reduce((sum, value) => sum + value, 0);
    const rightScore = Object.values(right.factorContributions).reduce((sum, value) => sum + value, 0);
    return rightScore - leftScore || left.id.localeCompare(right.id);
  });
}
