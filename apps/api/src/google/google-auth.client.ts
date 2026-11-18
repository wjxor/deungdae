import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { externalApiError, unauthorized } from '../common/api-exception.js';
import {
  callExternal,
  codeText,
  FORM_CONTENT_TYPE,
  parseJson,
} from '../common/external-http.js';
import {
  nicknameOrDefault,
  type SocialProfile,
} from '../auth/social-profile.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const RETRY_LOGIN_MESSAGE = 'Google 로그인을 다시 해 주세요';
const LOGIN_FAILURE_MESSAGE =
  'Google 로그인이 잠시 안 되고 있어요. 잠시 후 다시 시도해 주세요';
const UNLINK_FAILURE_MESSAGE =
  '탈퇴를 잠시 처리하지 못했어요. 잠시 후 다시 시도해 주세요';

/**
 * 구글 로그인 REST API 호출 (API.md 5장, FR-011) — 토큰 받기, 사용자 정보(OpenID userinfo), 연결 끊기(토큰 취소).
 * 웹이 `scope=openid profile`로 인가 코드를 받고, 토큰 교환만 서버가 Client Secret으로 한다. 이메일은 받지 않는다.
 * Client ID·Secret은 서버 환경변수로만 쓰고, 로그에는 키·토큰·인가 코드·회원번호를 남기지 않는다
 */
@Injectable()
export class GoogleAuthClient {
  private readonly logger = new Logger(GoogleAuthClient.name);
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID') || undefined;
    this.clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET') || undefined;
    const missing = [
      ['GOOGLE_CLIENT_ID', this.clientId],
      ['GOOGLE_CLIENT_SECRET', this.clientSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      this.logger.warn(
        `${missing.join('·')}가 없어 Google 로그인·탈퇴가 실패합니다. 저장소 루트 .env를 확인하세요`,
      );
    }
  }

  /**
   * 인가 코드를 구글 액세스 토큰으로 바꾼다. redirectUri는 인가 요청 때 쓴 값과 같아야 한다.
   * 코드가 만료·재사용돼 구글이 거부하면(400 `invalid_grant`) 401, 클라이언트·주소 설정 오류를 포함한 그 밖의 실패는 502
   */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const { clientId, clientSecret } = this.requireKeys(LOGIN_FAILURE_MESSAGE);
    const reply = await this.call(
      '토큰 받기',
      TOKEN_URL,
      formPost({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      LOGIN_FAILURE_MESSAGE,
    );

    const body = parseJson(reply.text) as {
      access_token?: unknown;
      error?: unknown;
    } | null;
    if (reply.ok && typeof body?.access_token === 'string') {
      return body.access_token;
    }
    if (reply.status === 400 && body?.error === 'invalid_grant') {
      // 사용자가 다시 로그인하면 풀리는 경우라 경고가 아니라 기록만 남긴다
      this.logger.log('Google 토큰 받기 거부: invalid_grant');
      throw unauthorized(RETRY_LOGIN_MESSAGE);
    }
    this.logger.warn(
      `Google 토큰 받기 HTTP ${reply.status}: ${codeText(body?.error)}`.trim(),
    );
    throw externalApiError(LOGIN_FAILURE_MESSAGE);
  }

  /** 구글 액세스 토큰으로 회원번호(`sub`)·이름을 받는다. 이름이 비면 "등대 회원" */
  async getProfile(accessToken: string): Promise<SocialProfile> {
    const reply = await this.call(
      '사용자 정보',
      USERINFO_URL,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      LOGIN_FAILURE_MESSAGE,
    );
    const body = reply.ok
      ? (parseJson(reply.text) as { sub?: unknown; name?: unknown } | null)
      : null;
    const sub = body?.sub;
    if (typeof sub !== 'string' || sub.trim() === '') {
      this.logger.warn(
        `Google 사용자 정보 HTTP ${reply.status}: 회원번호 없음`,
      );
      throw externalApiError(LOGIN_FAILURE_MESSAGE);
    }
    return { providerId: sub, nickname: nicknameOrDefault(body?.name) };
  }

  /**
   * 그 액세스 토큰을 취소해 구글 연결을 끊는다 (탈퇴). 200이 아니면 502라서
   * 부르는 쪽은 DB를 지우지 않고 다시 시도하게 한다
   */
  async revoke(accessToken: string): Promise<void> {
    const reply = await this.call(
      '연결 끊기',
      REVOKE_URL,
      formPost({ token: accessToken }),
      UNLINK_FAILURE_MESSAGE,
    );
    if (reply.ok) return;
    const body = parseJson(reply.text) as { error?: unknown } | null;
    this.logger.warn(
      `Google 연결 끊기 HTTP ${reply.status}: ${codeText(body?.error)}`.trim(),
    );
    throw externalApiError(UNLINK_FAILURE_MESSAGE);
  }

  /** Client ID·Secret. 없으면 구글을 부르기 전에 502 (인가 코드는 한 번만 쓸 수 있어서) */
  private requireKeys(failureMessage: string): {
    clientId: string;
    clientSecret: string;
  } {
    if (!this.clientId || !this.clientSecret) {
      throw externalApiError(failureMessage);
    }
    return { clientId: this.clientId, clientSecret: this.clientSecret };
  }

  /** 구글을 부른다. 로그 앞에 "Google"을 붙인다 */
  private call(
    label: string,
    url: string,
    init: RequestInit,
    failureMessage: string,
  ) {
    return callExternal(
      this.logger,
      `Google ${label}`,
      url,
      init,
      failureMessage,
    );
  }
}

/** 폼 본문 POST 요청 */
function formPost(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': FORM_CONTENT_TYPE },
    body: new URLSearchParams(fields).toString(),
  };
}
