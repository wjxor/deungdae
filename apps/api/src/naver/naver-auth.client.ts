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

const TOKEN_URL = 'https://nid.naver.com/oauth2.0/token';
const PROFILE_URL = 'https://openapi.naver.com/v1/nid/me';

const RETRY_LOGIN_MESSAGE = '네이버 로그인을 다시 해 주세요';
const LOGIN_FAILURE_MESSAGE =
  '네이버 로그인이 잠시 안 되고 있어요. 잠시 후 다시 시도해 주세요';
const UNLINK_FAILURE_MESSAGE =
  '탈퇴를 잠시 처리하지 못했어요. 잠시 후 다시 시도해 주세요';

/** 토큰 요청에서 이 error면 코드 만료·재사용이나 state 불일치라 사용자가 다시 로그인하면 풀린다 */
const RETRY_LOGIN_ERRORS = new Set(['invalid_request', 'invalid_grant']);

/**
 * 네이버 로그인 REST API 호출 (API.md 5장, FR-011) — 토큰 받기, 사용자 정보, 연결 끊기(토큰 삭제).
 * 인가 코드는 웹이 네이버 인가 주소로 보내 받고, 토큰 교환만 서버가 Client Secret으로 한다.
 * Client ID·Secret은 서버 환경변수로만 쓰고, 로그에는 키·토큰·인가 코드·회원번호를 남기지 않는다
 */
@Injectable()
export class NaverAuthClient {
  private readonly logger = new Logger(NaverAuthClient.name);
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('NAVER_CLIENT_ID') || undefined;
    this.clientSecret = config.get<string>('NAVER_CLIENT_SECRET') || undefined;
    const missing = [
      ['NAVER_CLIENT_ID', this.clientId],
      ['NAVER_CLIENT_SECRET', this.clientSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      this.logger.warn(
        `${missing.join('·')}가 없어 네이버 로그인·탈퇴가 실패합니다. 저장소 루트 .env를 확인하세요`,
      );
    }
  }

  /**
   * 인가 코드를 네이버 액세스 토큰으로 바꾼다. state는 인가 요청 때 보낸 값과 같아야 한다.
   * 네이버는 거부도 HTTP 200에 `error`로 알려 준다 — 코드 만료·재사용·state 불일치면 401, 그 밖의 실패는 502
   */
  async exchangeCode(code: string, state: string): Promise<string> {
    const { clientId, clientSecret } = this.requireKeys(LOGIN_FAILURE_MESSAGE);
    const reply = await this.call(
      '토큰 받기',
      TOKEN_URL,
      formPost({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        state,
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
    if (
      reply.status < 500 &&
      typeof body?.error === 'string' &&
      RETRY_LOGIN_ERRORS.has(body.error)
    ) {
      // 사용자가 다시 로그인하면 풀리는 경우라 경고가 아니라 기록만 남긴다
      this.logger.log(`네이버 토큰 받기 거부: ${body.error}`);
      throw unauthorized(RETRY_LOGIN_MESSAGE);
    }
    this.logger.warn(
      `네이버 토큰 받기 HTTP ${reply.status}: ${codeText(body?.error)}`.trim(),
    );
    throw externalApiError(LOGIN_FAILURE_MESSAGE);
  }

  /** 네이버 액세스 토큰으로 회원번호(`response.id`)·별명을 받는다. 별명이 비면 "등대 회원" */
  async getProfile(accessToken: string): Promise<SocialProfile> {
    const reply = await this.call(
      '사용자 정보',
      PROFILE_URL,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      LOGIN_FAILURE_MESSAGE,
    );
    const body = reply.ok
      ? (parseJson(reply.text) as {
          response?: { id?: unknown; nickname?: unknown };
        } | null)
      : null;
    const id = body?.response?.id;
    if (typeof id !== 'string' || id.trim() === '') {
      this.logger.warn(
        `네이버 사용자 정보 HTTP ${reply.status}: 회원번호 없음`,
      );
      throw externalApiError(LOGIN_FAILURE_MESSAGE);
    }
    return {
      providerId: id,
      nickname: nicknameOrDefault(body?.response?.nickname),
    };
  }

  /**
   * 그 액세스 토큰을 삭제해 네이버 연결을 끊는다 (탈퇴). `result`가 `success`가 아니면 502라서
   * 부르는 쪽은 DB를 지우지 않고 다시 시도하게 한다
   */
  async revoke(accessToken: string): Promise<void> {
    const { clientId, clientSecret } = this.requireKeys(UNLINK_FAILURE_MESSAGE);
    const reply = await this.call(
      '연결 끊기',
      TOKEN_URL,
      formPost({
        grant_type: 'delete',
        client_id: clientId,
        client_secret: clientSecret,
        access_token: accessToken,
        service_provider: 'NAVER',
      }),
      UNLINK_FAILURE_MESSAGE,
    );
    const body = parseJson(reply.text) as {
      result?: unknown;
      error?: unknown;
    } | null;
    if (reply.ok && body?.result === 'success') return;
    this.logger.warn(
      `네이버 연결 끊기 HTTP ${reply.status}: ${codeText(body?.error)}`.trim(),
    );
    throw externalApiError(UNLINK_FAILURE_MESSAGE);
  }

  /** Client ID·Secret. 없으면 네이버를 부르기 전에 502 (인가 코드는 한 번만 쓸 수 있어서) */
  private requireKeys(failureMessage: string): {
    clientId: string;
    clientSecret: string;
  } {
    if (!this.clientId || !this.clientSecret) {
      throw externalApiError(failureMessage);
    }
    return { clientId: this.clientId, clientSecret: this.clientSecret };
  }

  /** 네이버를 부른다. 로그 앞에 "네이버"를 붙인다 */
  private call(
    label: string,
    url: string,
    init: RequestInit,
    failureMessage: string,
  ) {
    return callExternal(
      this.logger,
      `네이버 ${label}`,
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
