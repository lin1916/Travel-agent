import type { Kysely } from 'kysely';
import type { Database } from '../types.js';

export class InboxRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async claim(
    consumerName: string,
    eventId: string,
    externalEventId?: string,
  ): Promise<boolean> {
    const inserted = await this.db
      .insertInto('inbox_messages')
      .values({
        consumer_name: consumerName,
        event_id: eventId,
        external_event_id: externalEventId ?? null,
        processed_at: new Date().toISOString(),
      })
      .onConflict(oc => oc.columns(['consumer_name', 'event_id']).doNothing())
      .returning('event_id')
      .executeTakeFirst();
    return Boolean(inserted);
  }
}
