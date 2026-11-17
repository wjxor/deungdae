import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AuthResponse,
  KakaoLoginRequest,
  SocialLoginRequest,
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
import { GoogleAuthClient } from '../google/google-auth.client.js';
import { KakaoAuthClient } from '../kakao/kakao-auth.client.js';
import { NaverAuthClient } from '../naver/naver-auth.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { signAccessToken, verifyAccessToken } from './jwt.js';
import { isAllowedRedirectUri } from './redirect-uri.js';
import type { SocialProfile } from './social-profile.js';

/** HS256 비밀값 최소 길이. 짧으면 토큰을 맞혀 볼 수 있어 받지 않는다 */
const MIN_SECRET_LENGTH = 32;

const SERVER_FAILURE_MESSAGE =
  '로그인을 잠시 처리하지 못했어요. 잠시 후 다시 시도해 주세요';
const EXPIRED_MESSAGE = '로그인이 만료됐어요. 다시 로그인해 주세요';
const BAD_REQUEST_MESSAGE = '로그인 요청 형식이 올바르지 않아요';

/** 안내 문구에 쓰는 서비스 이름 */
const PROVIDER_LABEL: Record<SocialProvider, string> = {
  kakao: '카카오',
  naver: '네이버',
  google: 'Google',
};

/**
 * 카카오·네이버·구글 로그인, 회원 정보, 탈퇴 (API.md 5장, FR-011).
 * 서버는 서비스 토큰을 저장하지 않고 우리 JWT(7일)만 내준다. 로그아웃은 웹이 토큰을 버리는 것이라 서버 일이 없다.
 * 같은 사람이 여러 서비스로 로그인하면 회원이 따로 생긴다 (`users`는 provider·회원번호로 구분)
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly secret: string | undefined;
  private readonly origins: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly kakao: KakaoAuthClient,
    private readonly naver: NaverAuthClient,
    private readonly google: GoogleAuthClient,
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

  /** 카카오 로그인 (`POST /auth/kakao`). `login('kakao', req)`와 같다 */
  loginWithKakao(req: KakaoLoginRequest): Promise<AuthResponse> {
    return this.login('kakao', req);
  }

  /**
   * 웹이 그 서비스에서 받은 인가 코드로 로그인한다. 서비스 회원번호로 회원을 찾고, 없으면 만들고, 있으면 닉네임을 최신 값으로 고친다.
   * 허용되지 않은 redirectUri·네이버인데 state가 없음은 400, 서비스가 코드를 거부하면 401, 서비스·DB 실패는 502
   */
  async login(
    provider: SocialProvider,
    req: SocialLoginRequest,
  ): Promise<AuthResponse> {
    this.checkRequest(provider, req);
    // 인가 코드는 한 번만 쓸 수 있어서, 우리 쪽 설정이 빠졌으면 서비스에 보내기 전에 멈춘다
    const secret = this.requireSecret();
    this.requireDb();

    const { profile } = await this.fetchProfile(provider, req);
    const { providerId, nickname } = profile;
    const row = await this.db(() =>
      this.prisma.user.upsert({
        where: { provider_providerId: { provider, providerId } },
        create: { provider, providerId, nickname },
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
   * 탈퇴 — 서비스 연결을 끊은 뒤 회원을 지운다. 연결 끊기가 실패하면 지우지 않고 502를 그대로 넘겨 다시 시도하게 한다.
   * - 카카오: 어드민 키로 회원번호만 있으면 끊는다. 사용자가 카카오에서 이미 끊었어도 지운다. `reauth`는 보지 않는다
   * - 네이버·구글: 그 사용자의 토큰이 있어야 끊을 수 있는데 토큰을 저장하지 않아서, 웹이 한 번 더 로그인해 받은 코드(`reauth`)로
   *   새 토큰을 받는다. 그 계정이 로그인한 회원과 다르면 400이고 끊지도 지우지도 않는다
   */
  async deleteAccount(
    userId: number,
    reauth: SocialLoginRequest | null = null,
  ): Promise<void> {
    const row = await this.findOrUnauthorized(userId);
    const provider = row.provider as SocialProvider;
    if (provider === 'kakao') {
      await this.kakao.unlink(row.providerId);
    } else {
      const label = PROVIDER_LABEL[provider];
      if (!reauth) {
        throw invalidInput(`탈퇴하려면 ${label} 로그인을 한 번 더 해 주세요`);
      }
      this.checkRequest(provider, reauth);
      const { accessToken, profile } = await this.fetchProfile(
        provider,
        reauth,
      );
      if (profile.providerId !== row.providerId) {
        throw invalidInput(
          // 네이버 인가 화면에는 계정 고르기가 없어서, 브라우저의 네이버 로그인이 다른 계정이면 다시 해도 같은 계정으로 돌아온다
          provider === 'naver'
            ? '로그인한 계정과 다른 네이버 계정이에요. 네이버에서 로그아웃한 뒤 같은 계정으로 다시 시도해 주세요'
            : `로그인한 계정과 다른 ${label} 계정이에요. 같은 계정으로 다시 시도해 주세요`,
        );
      }
      await (provider === 'naver' ? this.naver : this.google).revoke(
        accessToken,
      );
    }
    await this.db(() => this.prisma.user.delete({ where: { id: userId } }));
  }

  /** redirectUri가 허용된 웹 주소의 루트인지, 네이버면 state가 있는지 본다. 아니면 400 */
  private checkRequest(provider: SocialProvider, req: SocialLoginRequest) {
    if (!isAllowedRedirectUri(req.redirectUri, this.origins)) {
      throw invalidInput(BAD_REQUEST_MESSAGE);
    }
    if (provider === 'naver' && !req.state) {
      throw invalidInput(BAD_REQUEST_MESSAGE);
    }
  }

  /**
   * 인가 코드를 그 서비스의 액세스 토큰으로 바꾸고 회원번호·닉네임을 받는다. 토큰은 탈퇴 때 연결을 끊는 데만 쓰고 저장하지 않는다.
   * 서비스 에러(401·502)는 그대로 넘긴다
   */
  private async fetchProfile(
    provider: SocialProvider,
    req: SocialLoginRequest,
  ): Promise<{ accessToken: string; profile: SocialProfile }> {
    let accessToken: string;
    let profile: SocialProfile;
    if (provider === 'kakao') {
      accessToken = await this.kakao.exchangeCode(req.code, req.redirectUri);
      profile = await this.kakao.getProfile(accessToken);
    } else if (provider === 'naver') {
      accessToken = await this.naver.exchangeCode(req.code, req.state ?? '');
      profile = await this.naver.getProfile(accessToken);
    } else {
      accessToken = await this.google.exchangeCode(req.code, req.redirectUri);
      profile = await this.google.getProfile(accessToken);
    }
    return { accessToken, profile };
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
