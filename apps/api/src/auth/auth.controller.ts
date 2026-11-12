import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthResponse, MeResponse } from '../../../../shared/types.js';
import { AuthGuard, type AuthedRequest } from './auth.guard.js';
import { parseKakaoLoginRequest } from './auth.request.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/kakao (API.md 5장). 웹이 카카오에서 받은 인가 코드로 로그인한다. 회원을 새로 만들 수도 있지만 로그인이라 200 */
  @Post('kakao')
  @HttpCode(HttpStatus.OK)
  loginWithKakao(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.loginWithKakao(parseKakaoLoginRequest(body));
  }

  /** GET /api/auth/me — 저장해 둔 토큰으로 로그인을 되살릴 때 */
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthedRequest): Promise<MeResponse> {
    return { user: await this.auth.me(req.userId) };
  }

  /** DELETE /api/auth/me — 탈퇴. 카카오 연결을 끊고 회원을 지운다 */
  @Delete('me')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAccount(@Req() req: AuthedRequest): Promise<void> {
    return this.auth.deleteAccount(req.userId);
  }
}
