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
import {
  parseDeleteAccountRequest,
  parseKakaoLoginRequest,
  parseSocialLoginRequest,
} from './auth.request.js';
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

  /** POST /api/auth/naver (API.md 5장). 웹이 네이버에서 받은 인가 코드와 state로 로그인한다 */
  @Post('naver')
  @HttpCode(HttpStatus.OK)
  loginWithNaver(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.login('naver', parseSocialLoginRequest(body));
  }

  /** POST /api/auth/google (API.md 5장). 웹이 구글에서 받은 인가 코드로 로그인한다 */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  loginWithGoogle(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.login('google', parseSocialLoginRequest(body));
  }

  /** GET /api/auth/me — 저장해 둔 토큰으로 로그인을 되살릴 때 */
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthedRequest): Promise<MeResponse> {
    return { user: await this.auth.me(req.userId) };
  }

  /**
   * DELETE /api/auth/me — 탈퇴. 서비스 연결을 끊고 회원을 지운다.
   * 카카오 회원은 본문이 없고, 네이버·구글 회원은 한 번 더 로그인해 받은 `{ code, redirectUri, state }`를 본문으로 보낸다
   */
  @Delete('me')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAccount(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<void> {
    return this.auth.deleteAccount(req.userId, parseDeleteAccountRequest(body));
  }
}
