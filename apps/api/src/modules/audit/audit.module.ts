import { Module, ServiceUnavailableException } from '@nestjs/common';
import { AuditServiceImpl } from '@travel/application';
import { AuditRepository, createDatabase } from '@travel/persistence';
import { AUDIT_SERVICE, AuditController } from './audit.controller.js';
class UnavailableAuditService { async append(): Promise<never> { throw new ServiceUnavailableException('durable audit storage is unavailable'); } async listForTrip(): Promise<never> { throw new ServiceUnavailableException('durable audit storage is unavailable'); } }
@Module({ controllers:[AuditController], providers:[{ provide: AUDIT_SERVICE, useFactory: () => { if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'test') return new UnavailableAuditService(); if (!process.env.DATABASE_URL) throw new Error('audit persistence unavailable: DATABASE_URL is required'); return new AuditServiceImpl(new AuditRepository(createDatabase())); } }], exports:[AUDIT_SERVICE] })
export class AuditModule {}

