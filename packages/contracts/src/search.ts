import { Money, OfferKind } from './money.js';
export interface RevalidateRequest { supplierId: string; offerSnapshotHash: string; offerId: string }
export interface RevalidatedOffer { offerId: string; snapshotHash: string; price: Money; inventoryAvailable: boolean; refundRulesHash: string }
export interface SupplierOffer { id: string; kind: OfferKind; supplierId: string; price: Money; snapshotHash: string; startsAt?: string; endsAt?: string; title?: string }
export interface OfferPage { offers: SupplierOffer[]; nextCursor?: string }
