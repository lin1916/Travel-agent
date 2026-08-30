import { createHash } from 'node:crypto';
import type { Money, NormalizedOffer, OfferKind } from '@travel/contracts';

export interface RawSupplierOffer { id: string; kind: OfferKind; supplierId: string; title?: string; amountCents: number; totalMinutes?: number; transferCount?: number; locationScore?: number; rating?: number; refundFlexibility?: number; refundSummary?: string }

export function normalizeChinaStandardTime(value: string): string {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('timestamp must include an explicit timezone');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('timestamp must be a valid ISO date');
  const localCst = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,3})?\+08:00$/);
  if (localCst) return `${localCst[1]}${(localCst[2] ?? '.000').padEnd(4, '0')}+08:00`;
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function normalizeOffer(raw: RawSupplierOffer, source: string, updatedAt: string): NormalizedOffer {
  const cstUpdatedAt = normalizeChinaStandardTime(updatedAt);
  const price: Money = { amountCents: Math.max(0, Math.trunc(raw.amountCents)), currency: 'CNY' };
  const normalized = { id: raw.id, kind: raw.kind, supplierId: raw.supplierId, title: raw.title ?? raw.id, price, totalMinutes: raw.totalMinutes, transferCount: raw.transferCount, locationScore: raw.locationScore, rating: raw.rating, refundFlexibility: raw.refundFlexibility, refundSummary: raw.refundSummary ?? '退改规则以供应商确认结果为准', source, updatedAt: cstUpdatedAt };
  return { ...normalized, snapshotHash: createHash('sha256').update(canonical(normalized)).digest('hex') };
}
