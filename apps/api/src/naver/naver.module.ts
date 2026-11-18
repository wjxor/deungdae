import { Module } from '@nestjs/common';
import { NaverAuthClient } from './naver-auth.client.js';

/** 네이버 로그인 REST API 호출 (FR-011) */
@Module({
  providers: [NaverAuthClient],
  exports: [NaverAuthClient],
})
export class NaverModule {}
