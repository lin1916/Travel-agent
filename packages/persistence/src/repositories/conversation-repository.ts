import type { Conversation, ConversationMessage } from '@travel/contracts';
import { redactSensitiveText } from '@travel/contracts';
import { sql, type Kysely } from 'kysely';
import type { Database, AgentConversationsTable } from '../types.js';
import type { DatabaseTransaction } from '../db.js';

export type StoredConversation = Conversation & { sessionId: string };

function redact(value: string): string {
  return redactSensitiveText(value);
}

function conversationRow(row: AgentConversationsTable, messages: ConversationMessage[]): StoredConversation {
  return {
    id: row.id,
    sessionId: row.session_id,
    providerName: redact(row.provider_name),
    model: redact(row.model),
    status: row.status,
    ...(row.trip_id ? { tripId: row.trip_id } : {}),
    ...(row.agent_run_id ? { agentRunId: row.agent_run_id } : {}),
    messages,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export class ConversationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(conversation: StoredConversation, tx?: DatabaseTransaction): Promise<void> {
    const connection = tx ?? this.db;
    await connection.insertInto('anonymous_sessions')
      .values({
        id: conversation.sessionId,
        expires_at: conversation.expiresAt,
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
      })
      .onConflict(oc => oc.column('id').doUpdateSet({
        expires_at: conversation.expiresAt,
        updated_at: conversation.updatedAt,
      }))
      .execute();
    if (conversation.tripId) {
      const trip = await connection.selectFrom('trips').select('owner_id').where('id', '=', conversation.tripId).executeTakeFirst();
      if (!trip || trip.owner_id !== conversation.sessionId) throw new Error('trip does not belong to session');
    }
    await connection.insertInto('agent_conversations').values({
      id: conversation.id,
      session_id: conversation.sessionId,
      provider_name: redact(conversation.providerName),
      model: redact(conversation.model),
      status: conversation.status,
      trip_id: conversation.tripId ?? null,
      agent_run_id: conversation.agentRunId ?? null,
      created_at: conversation.createdAt,
      updated_at: conversation.updatedAt,
      expires_at: conversation.expiresAt,
    }).execute();
    await this.saveMessages(connection, conversation.id, conversation.messages);
  }

  async get(id: string): Promise<StoredConversation | undefined> {
    const row = await this.db.selectFrom('agent_conversations').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? conversationRow(row, await this.messages(id)) : undefined;
  }

  async getForSession(sessionId: string, id: string): Promise<StoredConversation | undefined> {
    const row = await this.db.selectFrom('agent_conversations').selectAll()
      .where('id', '=', id).where('session_id', '=', sessionId).executeTakeFirst();
    return row ? conversationRow(row, await this.messages(id)) : undefined;
  }

  async expiredBefore(timestamp: string): Promise<StoredConversation[]> {
    const rows = await this.db.selectFrom('agent_conversations').selectAll()
      .where('expires_at', '<=', timestamp).orderBy('expires_at').execute();
    return Promise.all(rows.map(async row => conversationRow(row, await this.messages(row.id))));
  }

  async save(conversation: StoredConversation, tx?: DatabaseTransaction): Promise<void> {
    const connection = tx ?? this.db;
    await connection.updateTable('agent_conversations').set({
      provider_name: redact(conversation.providerName),
      model: redact(conversation.model),
      status: conversation.status,
      trip_id: conversation.tripId ?? null,
      agent_run_id: conversation.agentRunId ?? null,
      updated_at: conversation.updatedAt,
      expires_at: conversation.expiresAt,
    }).where('id', '=', conversation.id).where('session_id', '=', conversation.sessionId).execute();
    await this.saveMessages(connection, conversation.id, conversation.messages);
  }

  async delete(id: string, tx?: DatabaseTransaction): Promise<void> {
    await (tx ?? this.db).deleteFrom('agent_conversations').where('id', '=', id).execute();
  }

  async expirePendingProposals(before: Date): Promise<number> {
    const result = await this.db.updateTable('plan_proposals').set({ status: 'expired', version: sql<number>`version + 1` })
      .where('status', '=', 'pending').where('expires_at', '<=', before.toISOString()).executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  async cleanupExpired(before: Date): Promise<number> {
    return this.db.transaction().execute(async tx => {
      const beforeIso = before.toISOString();
      const expiredConversations = await tx.selectFrom('agent_conversations').select(['id', 'session_id'])
        .where('expires_at', '<=', beforeIso).execute();
      const expiredSessions = await tx.selectFrom('anonymous_sessions').select('id')
        .where('expires_at', '<=', beforeIso).execute();
      const expiredSessionIds = expiredSessions.map(session => session.id);
      const sessionConversations = expiredSessionIds.length
        ? await tx.selectFrom('agent_conversations').select('id').where('session_id', 'in', expiredSessionIds).execute()
        : [];
      const conversationIds = [...new Set([
        ...expiredConversations.map(conversation => conversation.id),
        ...sessionConversations.map(conversation => conversation.id),
      ])];
      for (const conversationId of conversationIds) {
        await tx.deleteFrom('event_log').where('aggregate_type', '=', 'conversation').where('aggregate_id', '=', conversationId).execute();
        await tx.deleteFrom('outbox_events').where('aggregate_type', '=', 'conversation').where('aggregate_id', '=', conversationId).execute();
      }
      if (conversationIds.length) {
        await tx.deleteFrom('agent_conversations').where('id', 'in', conversationIds).execute();
      }
      const result = await tx.deleteFrom('anonymous_sessions').where('expires_at', '<=', beforeIso).executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    });
  }

  async deleteConversationData(conversationId: string, tx?: DatabaseTransaction): Promise<void> {
    const connection = tx ?? this.db;
    await connection.deleteFrom('event_log').where('aggregate_type', '=', 'conversation').where('aggregate_id', '=', conversationId).execute();
    await connection.deleteFrom('outbox_events').where('aggregate_type', '=', 'conversation').where('aggregate_id', '=', conversationId).execute();
    await connection.deleteFrom('agent_runs').where('conversation_id', '=', conversationId).execute();
    await connection.deleteFrom('agent_conversations').where('id', '=', conversationId).execute();
  }

  private async messages(conversationId: string): Promise<ConversationMessage[]> {
    const rows = await this.db.selectFrom('agent_messages').selectAll()
      .where('conversation_id', '=', conversationId).orderBy('sequence').execute();
    return rows.map(row => ({
      id: row.id,
      role: row.role,
      ...(row.client_message_id ? { clientMessageId: row.client_message_id } : {}),
      content: redact(row.content),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  private async saveMessages(connection: Kysely<Database> | DatabaseTransaction, conversationId: string, messages: ConversationMessage[]): Promise<void> {
    if (!messages.length) return;
    await connection.insertInto('agent_messages').values(messages.map((message, index) => ({
      id: message.id,
      conversation_id: conversationId,
      sequence: index + 1,
      role: message.role,
      content: redact(message.content),
      client_message_id: message.role === 'user' ? message.clientMessageId ?? null : null,
      created_at: message.createdAt,
    }))).onConflict(oc => oc.column('id').doNothing()).execute();
  }
}

export { ConversationRepository as PostgresConversationRepository };
