import type {
  EventEnvelope,
  TaskKind,
  TaskOutcome,
  TripRecord,
} from '@travel/contracts';
import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import { createHash } from 'node:crypto';

export interface TripsTable {
  id: string;
  owner_id: string;
  version: number;
  destination: string;
  starts_at: string;
  ends_at: string;
  traveler_count: number;
  created_at: string;
  updated_at: string;
}

export interface IdempotencyKeysTable {
  scope: string;
  key: string;
  request_hash: string;
  status: 'claimed' | 'completed';
  response_json: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface TasksTable {
  id: string;
  kind: TaskKind;
  status: 'pending' | 'leased' | 'completed' | 'dead_letter';
  payload_json: string;
  attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutboxEventsTable {
  id: Generated<number>;
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
  event_type: string;
  payload_json: string;
  published_at: string | null;
  created_at: string;
}

export interface InboxMessagesTable {
  consumer_name: string;
  event_id: string;
  external_event_id: string | null;
  processed_at: string;
}

export interface EventLogTable {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  run_id: string | null;
  sequence: number;
  schema_version: number;
  occurred_at: string;
  request_id: string;
  correlation_id: string;
  payload_json: string;
}

export interface SchemaMigrationsTable {
  name: string;
  applied_at: string;
}

export interface ItineraryItemsTable {
  id: string;
  trip_id: string;
  version: number;
  category: string;
  starts_at: string;
  ends_at: string;
  location_json: string | null;
  offer_id: string | null;
  supplier_order_id: string | null;
  confirmed: boolean;
}

export interface BudgetLedgersTable {
  trip_id: string;
  total_limit_cents: number;
  category_limits_json: string;
  estimated_cents: number;
  reserved_cents: number;
  committed_cents: number;
  paid_cents: number;
  released_cents: number;
  category_paid_json: string;
  updated_at: string;
}

export interface BudgetDeltaKeysTable {
  trip_id: string;
  idempotency_key: string;
  applied_at: string;
}

export interface OffersTable {
  trip_id: string;
  offer_id: string;
  kind: string;
  supplier_id: string;
  snapshot_hash: string;
  source: string;
  updated_at: string;
  payload_json: string;
  created_at: string;
}

export interface AgentRunsTable {
  id: string;
  trip_id: string;
  actor_id: string | null;
  status: string;
  user_message: string;
  assistant_message: string;
  missing_fields_json: string;
  tool_calls_json: string;
  tool_call_summaries_json: string;
  action_requests_json: string;
  next_step: string | null;
  current_trip_version: number;
  created_at: string;
  updated_at: string;
}

export interface TravelerVaultRefsTable {
  id: string;
  owner_id: string;
  vault_traveler_id: string;
  field_names_json: string;
  retention_until: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MandatesTable { id: string; version: number; trip_id: string; owner_id: string; payload_json: string; policy_hash: string; actor_id: string; created_at: string; valid_until: string; revoked_at: string | null }
export interface ActionRequestsTable { id: string; trip_id: string; owner_id: string; version: number; status: string; payload_json: string; request_hash: string; policy_snapshot_json: string | null; decision_actor_id: string | null; decision_reason: string | null; correlation_id: string; expires_at: string; consumed_at: string | null; created_at: string }
export interface BookingIntentsTable { id: string; trip_id: string; owner_id: string; offer_id: string; offer_kind: string; status: string; version: number; payload_json: string; created_at: string; updated_at: string }
export interface SupplierOrdersTable { id: string; intent_id: string; supplier_id: string; lifecycle_status: string; reconciliation_status: string; payload_json: string; external_idempotency_key: string; created_at: string }

export interface Database {
  trips: TripsTable;
  idempotency_keys: IdempotencyKeysTable;
  tasks: TasksTable;
  outbox_events: OutboxEventsTable;
  inbox_messages: InboxMessagesTable;
  event_log: EventLogTable;
  schema_migrations: SchemaMigrationsTable;
  itinerary_items: ItineraryItemsTable;
  budget_ledgers: BudgetLedgersTable;
  budget_delta_keys: BudgetDeltaKeysTable;
  offers: OffersTable;
  agent_runs: AgentRunsTable;
  traveler_vault_refs: TravelerVaultRefsTable;
  mandates: MandatesTable;
  action_requests: ActionRequestsTable;
  booking_intents: BookingIntentsTable;
  supplier_orders: SupplierOrdersTable;
}

export type TripRow = Selectable<TripsTable>;
export type NewTripRow = Insertable<TripsTable>;
export type TripPatch = Updateable<TripsTable>;
export type TaskRow = Selectable<TasksTable>;
export type NewTaskRow = Insertable<TasksTable>;

export interface CreateTripInput {
  id: string;
  ownerId: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  travelerCount: number;
}

export interface EnqueueTaskInput {
  id: string;
  kind: TaskKind;
  payload: unknown;
  availableAt?: Date;
}

export interface LeasedTask {
  id: string;
  kind: TaskKind;
  payload: unknown;
  attempts: number;
  leaseOwner: string;
  leaseUntil: string;
}

export interface TaskCompletion {
  status: Extract<TaskOutcome['status'], 'completed' | 'dead_letter'>;
  error?: string;
}

export type EventAppendInput = Omit<EventEnvelope, 'sequence'>;

function canonicalizeRequest(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('idempotency requests must use finite JSON numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeRequest).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalizeRequest(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('idempotency requests must be JSON values');
}

export function canonicalRequestJson(request: unknown): string {
  return canonicalizeRequest(request);
}

export function canonicalRequestHash(request: unknown): string {
  return createHash('sha256').update(canonicalRequestJson(request)).digest('hex');
}

export function toTripRecord(row: TripRow): TripRecord {
  return {
    id: row.id,
    version: row.version,
    ownerId: row.owner_id,
    destination: row.destination,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    travelerCount: row.traveler_count,
  };
}

export class RepositoryConflictError extends Error {
  constructor(message = 'resource version conflict') {
    super(message);
    this.name = 'RepositoryConflictError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('idempotency key was reused with a different request');
    this.name = 'IdempotencyConflictError';
  }
}

export class TaskConflictError extends Error {
  constructor(taskId: string) {
    super(`task id conflict: ${taskId}`);
    this.name = 'TaskConflictError';
  }
}

export class DatabaseConfigurationError extends Error {
  constructor() {
    super('DATABASE_URL is required for PostgreSQL persistence');
    this.name = 'DatabaseConfigurationError';
  }
}

export function eventToRow(event: EventEnvelope): EventLogTable {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    run_id: event.run_id ?? null,
    sequence: event.sequence,
    schema_version: event.schema_version,
    occurred_at: event.occurred_at,
    request_id: event.request_id,
    correlation_id: event.correlation_id,
    payload_json: JSON.stringify(event.redacted_payload),
  };
}
