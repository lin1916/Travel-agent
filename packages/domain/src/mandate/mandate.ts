import type { TravelMandate } from '@travel/contracts';

export interface MandateMetadata { ownerId: string; actorId: string; createdAt: string; policyHash: string }
export interface VersionedMandate extends TravelMandate, MandateMetadata {}

function policyHash(mandate: TravelMandate): string {
  const canonical = JSON.stringify({ ...mandate, revokedAt: undefined });
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) hash = Math.imul(hash ^ canonical.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createMandateVersion(ownerId: string, actorId: string, input: Omit<TravelMandate, 'version' | 'revokedAt'>, now = new Date().toISOString()): VersionedMandate {
  const mandate: TravelMandate = { ...structuredClone(input), version: 1 };
  return { ...mandate, ownerId, actorId, createdAt: now, policyHash: policyHash(mandate) };
}

/** In-memory, append-only mandate history used by API/tests when PostgreSQL is unavailable. */
export class MandateStore {
  private readonly histories = new Map<string, VersionedMandate[]>();

  create(ownerId: string, input: Omit<TravelMandate, 'version' | 'revokedAt'>, actorId = ownerId, now = new Date().toISOString()): VersionedMandate {
    const created = createMandateVersion(ownerId, actorId, input, now);
    if (this.histories.has(created.id)) throw new Error('mandate already exists');
    this.histories.set(created.id, [created]);
    return structuredClone(created);
  }

  get(id: string, ownerId?: string, version?: number): VersionedMandate | null {
    const history = this.histories.get(id) ?? [];
    const found = version === undefined ? history[history.length - 1] : history.find(item => item.version === version);
    if (!found || (ownerId && found.ownerId !== ownerId)) return null;
    return structuredClone(found);
  }

  listByTrip(tripId: string, ownerId: string): VersionedMandate[] {
    return [...this.histories.values()].flatMap(history => {
      const latest = history[history.length - 1];
      return latest && latest.tripId === tripId && latest.ownerId === ownerId ? [structuredClone(latest)] : [];
    });
  }

  amend(id: string, ownerId: string, expectedVersion: number, patch: Partial<Omit<TravelMandate, 'id' | 'tripId' | 'version' | 'revokedAt'>>, actorId = ownerId, now = new Date().toISOString()): VersionedMandate {
    const current = this.get(id, ownerId);
    if (!current) throw new Error('mandate not found');
    if (current.version !== expectedVersion) throw new Error('mandate version changed');
    const next: TravelMandate = { ...current, ...structuredClone(patch), version: current.version + 1, revokedAt: undefined };
    const versioned = { ...next, ownerId, actorId, createdAt: now, policyHash: policyHash(next) };
    this.histories.set(id, [...(this.histories.get(id) ?? []), versioned]);
    return structuredClone(versioned);
  }

  revoke(id: string, ownerId: string, expectedVersion: number, actorId = ownerId, now = new Date().toISOString()): VersionedMandate {
    const current = this.get(id, ownerId);
    if (!current) throw new Error('mandate not found');
    if (current.version !== expectedVersion) throw new Error('mandate version changed');
    const next: TravelMandate = { ...current, version: current.version + 1, revokedAt: now };
    const versioned = { ...next, ownerId, actorId, createdAt: now, policyHash: policyHash(next) };
    this.histories.set(id, [...(this.histories.get(id) ?? []), versioned]);
    return structuredClone(versioned);
  }
}
