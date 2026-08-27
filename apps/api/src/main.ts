import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ApplicationErrorFilter } from './app-error.filter.js';

const port = Number(process.env.API_PORT ?? 3000);
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
app.useGlobalFilters(new ApplicationErrorFilter());
await app.listen(port, '0.0.0.0');
