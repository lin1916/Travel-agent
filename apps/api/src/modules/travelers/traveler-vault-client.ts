export interface GrantIssueInput {
  intentId: string;
  intentVersion: number;
  supplierLegalEntity: string;
  travelerIds: string[];
  allowedFields: string[];
  purpose: string;
  offerSnapshotHash: string;
  authorizationRef: string;
  expiresAt: string;
}

export interface TravelerVaultClient {
  storeFields(actorId: string, input: { travelerId: string; fields: Record<string, string>; retentionUntil: string }):
    Promise<{ travelerId: string; fieldNames: string[]; retentionUntil: string }>;
  deleteField(actorId: string, travelerId: string, fieldName: string): Promise<{ deleted: boolean }>;
  issueGrant(actorId: string, input: GrantIssueInput): Promise<{ id: string; intentId: string; expiresAt: string }>;
  revokeGrant(actorId: string, input: { id: string; intentId: string; expiresAt: string; reason: string }):
    Promise<{ revoked: boolean }>;
}

export const TRAVELER_VAULT_CLIENT = Symbol('TRAVELER_VAULT_CLIENT');
export const TRAVELER_VAULT_REF_STORE = Symbol('TRAVELER_VAULT_REF_STORE');
