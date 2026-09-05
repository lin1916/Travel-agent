import { Module } from '@nestjs/common';
import { AnonymousSessionModule } from '../sessions/anonymous-session.module.js';
import { PlanningRuntimeModule } from '../agent/planning-runtime.module.js';
import { ProposalController } from './proposal.controller.js';

@Module({ imports: [PlanningRuntimeModule, AnonymousSessionModule], controllers: [ProposalController] })
export class ProposalModule {}
