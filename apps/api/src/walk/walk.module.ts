import { Module } from '@nestjs/common';
import { KakaoWalkClient } from './kakao-walk.client.js';
import { RouteCacheService } from './route-cache.service.js';
import { WalkRouteService } from './walk-route.service.js';

/**
 * 도보 경로 호출과 캐시. 장소 검색(`kakao/`)과 나눠 둔 것은 경로 품질 문제가 생기면
 * 이 모듈의 카카오 호출만 티맵 보행자 API로 바꾸기 위해서다 (CLAUDE.md)
 */
@Module({
  providers: [KakaoWalkClient, RouteCacheService, WalkRouteService],
  exports: [WalkRouteService],
})
export class WalkModule {}
