import { Module } from '@nestjs/common';
import { WalkModule } from '../walk/walk.module.js';
import { RoutesController } from './routes.controller.js';
import { RoutesService } from './routes.service.js';
import { SafetyScoreService } from './safety-score.service.js';

@Module({
  imports: [WalkModule],
  controllers: [RoutesController],
  providers: [RoutesService, SafetyScoreService],
})
export class RoutesModule {}
