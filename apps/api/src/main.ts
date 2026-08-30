import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ApplicationErrorFilter } from './app-error.filter.js';
import { closeDatabase, createDatabase, migrateToLatest } from '@travel/persistence';

const port = Number(process.env.API_PORT ?? 3000);
const bootstrapDb = createDatabase();
await migrateToLatest(bootstrapDb);
await closeDatabase(bootstrapDb);
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { rawBody: true });
app.useGlobalFilters(new ApplicationErrorFilter());
await app.listen(port, '0.0.0.0');
