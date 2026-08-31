import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ApplicationErrorFilter } from './app-error.filter.js';
import { closeDatabase, createDatabase, migrateToLatest } from '@travel/persistence';
import { buildSecurityHeaders } from '@travel/security';

const port = Number(process.env.API_PORT ?? 3000);
const bootstrapDb = createDatabase();
await migrateToLatest(bootstrapDb);
await closeDatabase(bootstrapDb);
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ bodyLimit: Number(process.env.REQUEST_BODY_LIMIT_BYTES ?? 1_000_000) }), { rawBody: true });
app.useGlobalFilters(new ApplicationErrorFilter());
const fastify = app.getHttpAdapter().getInstance();
fastify.addHook('onSend', async (_request: unknown, reply: { header(name: string, value: string): void }) => {
  for (const [name, value] of Object.entries(buildSecurityHeaders())) reply.header(name, value);
});
await app.listen(port, '0.0.0.0');
