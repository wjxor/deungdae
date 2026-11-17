import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module.js';
import { KakaoModule } from '../kakao/kakao.module.js';
import { NaverModule } from '../naver/naver.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

/** 카카오·네이버·구글 로그인, 회원 정보, 탈퇴 (API.md 5장, FR-011) */
@Module({
  imports: [KakaoModule, NaverModule, GoogleModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
})
export class AuthModule {}
