import type { CandidatePlace, Place } from '@travel/contracts';
import { CandidatePlaceSchema, PlaceSchema } from '@travel/contracts';
import type { Kysely } from 'kysely';
import type { Database, CandidatePlacesTable } from '../types.js';
import type { DatabaseTransaction } from '../db.js';
import { RepositoryConflictError } from '../types.js';

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }

function fromRow(row: CandidatePlacesTable): CandidatePlace {
  return CandidatePlaceSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    place: PlaceSchema.parse(JSON.parse(row.place_json)),
    source: row.source,
    ...(row.note ? { note: row.note } : {}),
    ...(row.priority === null ? {} : { priority: Number(row.priority) }),
    createdAt: iso(row.created_at),
  });
}

export class CandidatePlaceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(candidate: CandidatePlace, tx?: DatabaseTransaction): Promise<void> {
    const place = PlaceSchema.parse(candidate.place);
    try {
      await (tx ?? this.db).insertInto('candidate_places').values({
        id: candidate.id,
        conversation_id: candidate.conversationId,
        place_json: JSON.stringify(place),
        provider: place.provider,
        provider_place_id: place.providerPlaceId,
        source: candidate.source,
        note: candidate.note ?? null,
        priority: candidate.priority ?? null,
        created_at: candidate.createdAt,
      }).execute();
    } catch (error) {
      if (error instanceof Error && /duplicate|unique/i.test(error.message)) throw new RepositoryConflictError('candidate place already exists');
      throw error;
    }
  }

  async get(id: string, tx?: DatabaseTransaction): Promise<CandidatePlace | undefined> {
    const row = await (tx ?? this.db).selectFrom('candidate_places').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }

  async getForConversation(conversationId: string, id: string, tx?: DatabaseTransaction): Promise<CandidatePlace | undefined> {
    const row = await (tx ?? this.db).selectFrom('candidate_places').selectAll()
      .where('conversation_id', '=', conversationId).where('id', '=', id).executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }

  async list(conversationId: string, tx?: DatabaseTransaction): Promise<CandidatePlace[]> {
    const rows = await (tx ?? this.db).selectFrom('candidate_places').selectAll()
      .where('conversation_id', '=', conversationId)
      .orderBy('priority', 'asc').orderBy('created_at', 'asc').execute();
    return rows.map(fromRow);
  }

  async findByProviderPlace(conversationId: string, provider: Place['provider'], providerPlaceId: string, tx?: DatabaseTransaction): Promise<CandidatePlace | undefined> {
    const row = await (tx ?? this.db).selectFrom('candidate_places').selectAll()
      .where('conversation_id', '=', conversationId).where('provider', '=', provider).where('provider_place_id', '=', providerPlaceId).executeTakeFirst();
    return row ? fromRow(row) : undefined;
  }

  async save(candidate: CandidatePlace, tx?: DatabaseTransaction): Promise<void> {
    const place = PlaceSchema.parse(candidate.place);
    const result = await (tx ?? this.db).updateTable('candidate_places').set({
      note: candidate.note ?? null,
      priority: candidate.priority ?? null,
    }).where('id', '=', candidate.id).where('conversation_id', '=', candidate.conversationId).executeTakeFirst();
    if (!result || Number(result.numUpdatedRows) === 0) throw new RepositoryConflictError('candidate place not found');
    void place;
  }

  async delete(id: string, tx?: DatabaseTransaction): Promise<void> {
    await (tx ?? this.db).deleteFrom('candidate_places').where('id', '=', id).execute();
  }

  async deleteConversation(conversationId: string, tx?: DatabaseTransaction): Promise<void> {
    await (tx ?? this.db).deleteFrom('candidate_places').where('conversation_id', '=', conversationId).execute();
  }
}

export { CandidatePlaceRepository as PostgresCandidateRepository };
