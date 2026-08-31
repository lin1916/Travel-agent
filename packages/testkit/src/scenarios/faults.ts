export const faultModes = [
  'normal',
  'offer_expired',
  'inventory_lost',
  'price_changed',
  'duplicate_webhook',
  'out_of_order_webhook',
  'worker_crash',
  'sse_reconnect',
  'vault_kms_outage',
  'mandate_revoked',
  'partial_success',
] as const;

export type FaultMode = typeof faultModes[number];

export function isFaultMode(value: string): value is FaultMode {
  return (faultModes as readonly string[]).includes(value);
}
