import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '@travel/persistence';
import { API_DATABASE } from '../../database.module.js';
import { isLocalPlanningMemoryMode } from '../../local-planning-memory-mode.js';
import type { AnonymousSessionResult, AnonymousSessionStore } from '../conversations/anonymous-session.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class DurableAnonymousSessionStore implements AnonymousSessionStore {
  private readonly sessions = new Map<string, number>();
  private readonly enabled: boolean;
  private readonly clock: { now(): Date; id(): string };

  constructor(
    @Optional() @Inject(API_DATABASE) private readonly db?: Kysely<Database>,
  ) {
    this.enabled = Boolean(db) && !isLocalPlanningMemoryMode();
    this.clock = { now: () => new Date(), id: () => randomUUID() };
  }

  async resolve(token?: string): Promise<AnonymousSessionResult> {
    if (token) {
      if (this.enabled && this.db) {
        const row = await this.db.selectFrom('anonymous_sessions').select('expires_at').where('id', '=', token).executeTakeFirst();
        if (!row || new Date(row.expires_at).getTime() <= this.clock.now().getTime()) return { id: token, expired: true };
        return { id: token };
      }
      const expiresAt = this.sessions.get(token);
      if (!expiresAt || expiresAt <= this.clock.now().getTime()) return { id: token, expired: true };
      return { id: token };
    }
    return this.create();
  }

  async rotateExpired(sessionId: string): Promise<{ id: string; cookie: string }> {
    if (this.enabled && this.db) {
      await this.db.transaction().execute(async tx => {
        const conversations = await tx.selectFrom('agent_conversations').select('id').where('session_id', '=', sessionId).execute();
        for (const conversation of conversations) {
          await tx.deleteFrom('event_log').where('aggregate_type', '=', 'conversation').where('aggregate_id', '=', conversation.id).execute();
          await tx.deleteFrom('outbox_events').where('aggregate_type', '=', 'conversation').where('aggregate_id', '=', conversation.id).execute();
        }
        await tx.deleteFrom('anonymous_sessions').where('id', '=', sessionId).execute();
      });
    } else {
      this.sessions.delete(sessionId);
    }
    return this.create();
  }

  async cleanupExpired(before: Date): Promise<number> {
    if (this.enabled && this.db) {
      const result = await this.db.deleteFrom('anonymous_sessions').where('expires_at', '<=', before.toISOString()).executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    }
    let deleted = 0;
    for (const [id, expiresAt] of this.sessions) {
      if (expiresAt <= before.getTime()) {
        this.sessions.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  private async create(): Promise<{ id: string; cookie: string }> {
    const id = this.clock.id();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + RETENTION_MS);
    if (this.enabled && this.db) {
      await this.db.insertInto('anonymous_sessions').values({
        id,
        expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).onConflict(oc => oc.column('id').doUpdateSet({ expires_at: expiresAt.toISOString(), updated_at: now.toISOString() })).execute();
    } else {
      this.sessions.set(id, expiresAt.getTime());
    }
    return { id, cookie: `travel_session=${id}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax` };
  }
}
