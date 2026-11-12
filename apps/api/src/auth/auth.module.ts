import { Module } from '@nestjs/common';
import { KakaoModule } from '../kakao/kakao.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

/** 카카오 로그인·회원 정보·탈퇴 (API.md 5장, FR-011) */
@Module({
  imports: [KakaoModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
})
export class AuthModule {}
