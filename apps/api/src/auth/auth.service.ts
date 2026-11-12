import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AuthResponse,
  KakaoLoginRequest,
  SocialProvider,
  User,
} from '../../../../shared/types.js';
import { allowedOrigins } from '../app.setup.js';
import {
  ApiException,
  externalApiError,
  invalidInput,
  unauthorized,
} from '../common/api-exception.js';
import { dbErrorText } from '../common/db-error.js';
import type { User as UserRow } from '../generated/prisma/client.js';
import { KakaoAuthClient } from '../kakao/kakao-auth.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { signAccessToken, verifyAccessToken } from './jwt.js';
import { isAllowedRedirectUri } from './redirect-uri.js';

/** HS256 비밀값 최소 길이. 짧으면 토큰을 맞혀 볼 수 있어 받지 않는다 */
const MIN_SECRET_LENGTH = 32;

const SERVER_FAILURE_MESSAGE =
  '로그인을 잠시 처리하지 못했어요. 잠시 후 다시 시도해 주세요';
const EXPIRED_MESSAGE = '로그인이 만료됐어요. 다시 로그인해 주세요';

/**
 * 카카오 로그인·회원 정보·탈퇴 (API.md 5장, FR-011).
 * 서버는 카카오 토큰을 저장하지 않고 우리 JWT(7일)만 내준다. 로그아웃은 웹이 토큰을 버리는 것이라 서버 일이 없다
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret: string | undefined;
  private readonly origins: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly kakao: KakaoAuthClient,
    config: ConfigService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    this.secret =
      secret && secret.length >= MIN_SECRET_LENGTH ? secret : undefined;
    if (!this.secret) {
      this.logger.warn(
        `JWT_SECRET이 없거나 ${MIN_SECRET_LENGTH}자보다 짧아 로그인이 실패합니다. 저장소 루트 .env를 확인하세요`,
      );
    }
    this.origins = allowedOrigins(config.get<string>('CORS_ORIGINS'));
  }

  /**
   * 웹이 카카오에서 받은 인가 코드로 로그인한다. 카카오 회원번호로 회원을 찾고, 없으면 만들고, 있으면 닉네임을 최신 값으로 고친다.
   * 허용되지 않은 redirectUri는 400, 카카오가 코드를 거부하면 401, 카카오·DB 실패는 502
   */
  async loginWithKakao(req: KakaoLoginRequest): Promise<AuthResponse> {
    if (!isAllowedRedirectUri(req.redirectUri, this.origins)) {
      throw invalidInput('로그인 요청 형식이 올바르지 않아요');
    }
    // 인가 코드는 한 번만 쓸 수 있어서, 우리 쪽 설정이 빠졌으면 카카오에 보내기 전에 멈춘다
    const secret = this.requireSecret();
    this.requireDb();

    const kakaoToken = await this.kakao.exchangeCode(req.code, req.redirectUri);
    const { providerId, nickname } = await this.kakao.getProfile(kakaoToken);
    const row = await this.db(() =>
      this.prisma.user.upsert({
        where: { provider_providerId: { provider: 'kakao', providerId } },
        create: { provider: 'kakao', providerId, nickname },
        update: { nickname },
      }),
    );
    return {
      user: toUser(row),
      accessToken: await signAccessToken(row.id, secret),
    };
  }

  /** 로그인 토큰에서 회원 id를 꺼낸다. 서명·만료·형식이 틀리면 401 */
  async userIdFromToken(token: string): Promise<number> {
    const userId = await verifyAccessToken(token, this.requireSecret());
    if (userId === null) throw unauthorized(EXPIRED_MESSAGE);
    return userId;
  }

  /** 로그인한 회원 정보. 그 사이 탈퇴해 회원이 없으면 401 */
  async me(userId: number): Promise<User> {
    return toUser(await this.findOrUnauthorized(userId));
  }

  /**
   * 탈퇴 — 카카오 연결을 끊은 뒤 회원을 지운다. 사용자가 카카오에서 이미 끊었어도 지운다.
   * 연결 끊기가 실패하면 지우지 않고 502를 그대로 넘겨 다시 시도하게 한다
   */
  async deleteAccount(userId: number): Promise<void> {
    const row = await this.findOrUnauthorized(userId);
    await this.kakao.unlink(row.providerId);
    await this.db(() => this.prisma.user.delete({ where: { id: userId } }));
  }

  /** 회원을 찾고, 없으면 401 */
  private async findOrUnauthorized(userId: number): Promise<UserRow> {
    this.requireDb();
    const row = await this.db(() =>
      this.prisma.user.findUnique({ where: { id: userId } }),
    );
    if (!row) throw unauthorized(EXPIRED_MESSAGE);
    return row;
  }

  /** JWT 비밀값. 없으면 502 */
  private requireSecret(): string {
    if (!this.secret) throw externalApiError(SERVER_FAILURE_MESSAGE);
    return this.secret;
  }

  /** DB 주소가 없으면 502 */
  private requireDb(): void {
    if (!this.prisma.configured) {
      throw externalApiError(SERVER_FAILURE_MESSAGE);
    }
  }

  /** DB 쿼리를 실행하고, 실패하면 이름·코드·첫 줄만 남기고 502로 바꾼다 */
  private async db<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (e) {
      if (e instanceof ApiException) throw e;
      this.logger.warn(`회원 DB 실패: ${dbErrorText(e)}`);
      throw externalApiError(SERVER_FAILURE_MESSAGE);
    }
  }
}

/** DB 행을 API 응답의 User로. 회원번호·가입 시각은 응답에 넣지 않는다 */
function toUser(row: UserRow): User {
  return {
    id: row.id,
    nickname: row.nickname,
    email: row.email,
    provider: row.provider as SocialProvider,
  };
}
