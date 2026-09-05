import { Module } from '@nestjs/common';
import { PlanningRuntimeModule } from '../agent/planning-runtime.module.js';
import { ConversationModule } from '../conversations/conversation.module.js';
import { AnonymousSessionModule } from '../sessions/anonymous-session.module.js';
import { TripModule } from '../trips/trip.module.js';
import { AMapJsProxy } from './amap-client.js';
import { ConversationMapController, MapController, MapPublicController } from './map.controller.js';

@Module({
  imports: [TripModule, ConversationModule, PlanningRuntimeModule, AnonymousSessionModule],
  controllers: [MapController, ConversationMapController, MapPublicController],
  providers: [
    { provide: AMapJsProxy, useFactory: () => new AMapJsProxy() },
  ],
})
export class MapModule {}
