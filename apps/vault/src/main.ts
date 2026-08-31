import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { VaultModule } from './vault.module.js';
import { buildSecurityHeaders } from '@travel/security';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(VaultModule, new FastifyAdapter());
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (_request: unknown, reply: { header(name: string, value: string): void }) => {
    for (const [name, value] of Object.entries(buildSecurityHeaders())) reply.header(name, value);
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.VAULT_PORT ?? 3001), process.env.VAULT_BIND_HOST ?? '127.0.0.1');
}

void bootstrap();
