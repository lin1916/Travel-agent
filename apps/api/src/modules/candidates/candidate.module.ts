import { Module } from '@nestjs/common';
import { AnonymousSessionModule } from '../sessions/anonymous-session.module.js';
import { PlanningRuntimeModule } from '../agent/planning-runtime.module.js';
import { CandidateController } from './candidate.controller.js';

@Module({ imports: [PlanningRuntimeModule, AnonymousSessionModule], controllers: [CandidateController] })
export class CandidateModule {}
