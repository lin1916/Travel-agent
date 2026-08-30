import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { Aes256GcmEnvelopeCrypto, EnvironmentKeyProvider } from '@travel/security';
import { GrantController } from './modules/grants/grant.controller.js';
import { PostgresGrantRepository, TravelerDataGrantService } from './modules/grants/grant.service.js';
import { VaultController } from './modules/vault/vault.controller.js';
import {
  closeVaultDatabase,
  createVaultDatabase,
  migrateVaultSchema,
  PostgresVaultRepository,
  type VaultDatabase,
} from './modules/vault/vault.repository.js';
import { VaultService } from './modules/vault/vault.service.js';
import type { Kysely } from 'kysely';

interface VaultRuntimeDependencies {
  database: Kysely<VaultDatabase>;
  vault: VaultService;
  grants: TravelerDataGrantService;
}

export function createVaultRuntimeDependencies(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): VaultRuntimeDependencies {
  const keys = EnvironmentKeyProvider.fromEnvironment(environment);
  const database = createVaultDatabase(environment.VAULT_DATABASE_URL);
  const vault = new VaultService(
    new PostgresVaultRepository(database),
    new Aes256GcmEnvelopeCrypto(keys),
  );
  const grants = new TravelerDataGrantService(
    new PostgresGrantRepository(database),
    vault,
    { now: () => new Date() },
  );
  return { database, vault, grants };
}

const VAULT_RUNTIME = Symbol('VAULT_RUNTIME');

class VaultShutdown implements OnApplicationShutdown {
  constructor(private readonly runtime: VaultRuntimeDependencies) {}

  async onApplicationShutdown(): Promise<void> {
    await closeVaultDatabase(this.runtime.database);
  }
}

@Module({
  controllers: [VaultController, GrantController],
  providers: [
    {
      provide: VAULT_RUNTIME,
      useFactory: async () => {
        const runtime = createVaultRuntimeDependencies(process.env);
        await migrateVaultSchema(runtime.database);
        return runtime;
      },
    },
    {
      provide: VaultService,
      inject: [VAULT_RUNTIME],
      useFactory: (runtime: VaultRuntimeDependencies) => runtime.vault,
    },
    {
      provide: TravelerDataGrantService,
      inject: [VAULT_RUNTIME],
      useFactory: (runtime: VaultRuntimeDependencies) => runtime.grants,
    },
    {
      provide: VaultShutdown,
      inject: [VAULT_RUNTIME],
      useFactory: (runtime: VaultRuntimeDependencies) => new VaultShutdown(runtime),
    },
  ],
})
export class VaultModule {}
