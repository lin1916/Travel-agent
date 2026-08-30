export const faultModes = ['normal', 'expired_offer', 'inventory_lost', 'price_changed', 'delayed', 'create_indeterminate', 'duplicate_webhook', 'out_of_order_webhook', 'prompt_injection_text'] as const;
export type FaultMode = typeof faultModes[number];

export function isFaultMode(value: string): value is FaultMode {
  return (faultModes as readonly string[]).includes(value);
}
