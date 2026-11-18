import { Module } from '@nestjs/common';
import { GoogleAuthClient } from './google-auth.client.js';

/** 구글 로그인 REST API 호출 (FR-011) */
@Module({
  providers: [GoogleAuthClient],
  exports: [GoogleAuthClient],
})
export class GoogleModule {}
