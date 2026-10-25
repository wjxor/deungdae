import { Module } from '@nestjs/common';
import { KakaoModule } from '../kakao/kakao.module.js';
import { PlacesController } from './places.controller.js';
import { PlacesService } from './places.service.js';

@Module({
  imports: [KakaoModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
