import { Module } from '@nestjs/common';
import { FacilitiesController } from './facilities.controller.js';
import { FacilitiesService } from './facilities.service.js';

@Module({
  controllers: [FacilitiesController],
  providers: [FacilitiesService],
})
export class FacilitiesModule {}
