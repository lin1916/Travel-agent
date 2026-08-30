import type { Kysely } from 'kysely';
import type { Database } from '../types.js';

export type InboxClaimState = 'claimed' | 'busy' | 'completed';

export class InboxRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async claim(consumerName: string, eventId: string, owner = eventId, claimedAt = new Date(), leaseSeconds = 30, externalEventId?: string): Promise<InboxClaimState> {
    const now = claimedAt.toISOString();
    const until = new Date(claimedAt.getTime() + leaseSeconds * 1_000).toISOString();
    const existing = await this.db.selectFrom('inbox_messages').select(['event_id', 'claim_owner', 'claim_until', 'delivered_at'])
      .where('consumer_name', '=', consumerName)
      .where(eb => externalEventId ? eb.or([eb('event_id', '=', eventId), eb('external_event_id', '=', externalEventId)]) : eb('event_id', '=', eventId)).executeTakeFirst();
    if (existing?.delivered_at) return 'completed';
    if (existing && existing.claim_until && existing.claim_until > now && existing.claim_owner !== owner) return 'busy';
    if (!existing) {
      try {
        await this.db.insertInto('inbox_messages').values({ consumer_name: consumerName, event_id: eventId, external_event_id: externalEventId ?? null, processed_at: now, claim_owner: owner, claim_until: until, delivered_at: null }).execute();
        return 'claimed';
      } catch {
        const raced = await this.db.selectFrom('inbox_messages').select(['event_id', 'delivered_at', 'claim_until', 'claim_owner']).where('consumer_name', '=', consumerName)
          .where(eb => externalEventId ? eb.or([eb('event_id', '=', eventId), eb('external_event_id', '=', externalEventId)]) : eb('event_id', '=', eventId)).executeTakeFirst();
        if (raced?.delivered_at) return 'completed';
        if (raced?.claim_until && raced.claim_until > now && raced.claim_owner !== owner) return 'busy';
      }
    }
    const updated = await this.db.updateTable('inbox_messages').set({ claim_owner: owner, claim_until: until, processed_at: now })
      .where('consumer_name', '=', consumerName).where('event_id', '=', existing?.event_id ?? eventId).where('delivered_at', 'is', null)
      .where(eb => eb.or([eb('claim_until', 'is', null), eb('claim_until', '<=', now), eb('claim_owner', '=', owner)]))
      .returning('event_id').executeTakeFirst();
    return updated ? 'claimed' : 'busy';
  }

  async complete(consumerName: string, eventId: string, owner: string, completedAt = new Date()): Promise<boolean> {
    const result = await this.db.updateTable('inbox_messages').set({ delivered_at: completedAt.toISOString(), claim_until: null })
      .where('consumer_name', '=', consumerName).where('event_id', '=', eventId).where('claim_owner', '=', owner).where('delivered_at', 'is', null).executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) === 1;
  }

  async release(consumerName: string, eventId: string, owner?: string): Promise<void> {
    let query = this.db.updateTable('inbox_messages').set({ claim_owner: null, claim_until: null }).where('consumer_name', '=', consumerName).where('event_id', '=', eventId).where('delivered_at', 'is', null);
    if (owner) query = query.where('claim_owner', '=', owner);
    await query.execute();
  }
}
