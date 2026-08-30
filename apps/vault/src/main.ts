import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { VaultModule } from './vault.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(VaultModule, new FastifyAdapter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.VAULT_PORT ?? 3001), '0.0.0.0');
}

void bootstrap();
