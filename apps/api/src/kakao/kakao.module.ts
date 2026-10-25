import { Module } from '@nestjs/common';
import { KakaoLocalClient } from './kakao-local.client.js';

/** 카카오 REST API 호출을 모아 둔다. 도보 경로 호출은 티맵으로 바꿀 수 있게 경로 모듈에 따로 둔다 (CLAUDE.md) */
@Module({
  providers: [KakaoLocalClient],
  exports: [KakaoLocalClient],
})
export class KakaoModule {}
