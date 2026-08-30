import { Module, ServiceUnavailableException } from '@nestjs/common';
import { createDatabase, WebhookRepository } from '@travel/persistence';
import { MockAttractionAdapter, MockDiningAdapter, MockStayAdapter, MockTransportAdapter } from '@travel/supplier-adapters';
import { SUPPLIER_ADAPTER_REGISTRY, WEBHOOK_INTAKE, WebhookController, type SupplierAdapterRegistry, type WebhookIntake } from './webhook.controller.js';
import { HmacWebhookVerifier, WEBHOOK_VERIFIER } from './webhook-verifier.js';

function webhookSecrets(): Record<string, string> {
  const configured = process.env.SUPPLIER_WEBHOOK_SECRETS_JSON;
  if (!configured) {
    if (process.env.NODE_ENV === 'test') return {};
    throw new Error('SUPPLIER_WEBHOOK_SECRETS_JSON is required');
  }
  const parsed = JSON.parse(configured) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('SUPPLIER_WEBHOOK_SECRETS_JSON must be an object');
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
    if (typeof value !== 'string' || !value) throw new Error(`webhook secret is missing for ${key}`);
    return [key, value];
  }));
}

class UnavailableWebhookIntake implements WebhookIntake {
  async accept(): Promise<boolean> { throw new ServiceUnavailableException('durable webhook intake is unavailable'); }
}

@Module({
  controllers: [WebhookController],
  providers: [
    { provide: WEBHOOK_VERIFIER, useFactory: () => { const secrets = webhookSecrets(); return new HmacWebhookVerifier(supplierId => secrets[supplierId]); } },
    { provide: WEBHOOK_INTAKE, useFactory: () => !process.env.DATABASE_URL && process.env.NODE_ENV === 'test' ? new UnavailableWebhookIntake() : new WebhookRepository(createDatabase()) },
    {
      provide: SUPPLIER_ADAPTER_REGISTRY,
      useFactory: (): SupplierAdapterRegistry => {
        const adapters = [new MockTransportAdapter(), new MockStayAdapter(), new MockAttractionAdapter(), new MockDiningAdapter()];
        const byId = new Map(adapters.map(adapter => [adapter.supplierId, adapter]));
        return { get: supplierId => byId.get(supplierId) };
      },
    },
  ],
})
export class WebhookModule {}
