import type { RevalidatedOffer } from '@travel/contracts';

export interface ImmutableOfferSnapshot { offerId: string; snapshotHash: string; priceCents: number; refundRulesHash: string }
export interface RevalidationAdapter { revalidate(input: { offerId: string; offerSnapshotHash: string }): Promise<RevalidatedOffer> }

export async function revalidateOffer(snapshot: ImmutableOfferSnapshot, adapter: RevalidationAdapter) {
  const current = await adapter.revalidate({ offerId: snapshot.offerId, offerSnapshotHash: snapshot.snapshotHash });
  return {
    unchanged: current.snapshotHash === snapshot.snapshotHash && current.inventoryAvailable && current.price.amountCents === snapshot.priceCents && current.refundRulesHash === snapshot.refundRulesHash,
    currentOfferSnapshotHash: current.snapshotHash,
    priceChanged: current.price.amountCents !== snapshot.priceCents,
    inventoryChanged: !current.inventoryAvailable,
    refundRulesChanged: current.refundRulesHash !== snapshot.refundRulesHash,
  };
}
