import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { externalApiError, unauthorized } from '../common/api-exception.js';

const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const USER_ME_URL = 'https://kapi.kakao.com/v2/user/me';
const UNLINK_URL = 'https://kapi.kakao.com/v1/user/unlink';

/** 카카오가 이 시간 안에 답하지 않으면 실패로 본다 (ms) */
const TIMEOUT_MS = 5000;

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded;charset=utf-8';

/** 카카오 닉네임이 비어 있을 때 쓰는 이름 */
export const DEFAULT_NICKNAME = '등대 회원';

const RETRY_LOGIN_MESSAGE = '카카오 로그인을 다시 해 주세요';
const LOGIN_FAILURE_MESSAGE =
  '카카오 로그인이 잠시 안 되고 있어요. 잠시 후 다시 시도해 주세요';
const UNLINK_FAILURE_MESSAGE =
  '탈퇴를 잠시 처리하지 못했어요. 잠시 후 다시 시도해 주세요';

/** 카카오 사용자 정보에서 쓰는 값. 회원번호는 Long이라 문자열로 둔다 */
export type KakaoProfile = { providerId: string; nickname: string };

/** 카카오 응답 한 번. 본문은 문자열로 받아 호출하는 쪽이 해석한다 */
type KakaoReply = { status: number; ok: boolean; text: string };

/**
 * 카카오 로그인 REST API 호출 (API.md 5장, FR-011) — 토큰 받기, 사용자 정보, 연결 끊기.
 * 인가 코드는 웹이 JS SDK(JS 키)로 받고, 토큰 교환만 서버가 REST 키와 클라이언트 시크릿으로 한다 (카카오 문서 "JavaScript SDK 카카오 로그인").
 * REST 키·시크릿·어드민 키는 서버 환경변수로만 쓰고, 로그에는 키·토큰·인가 코드·회원번호를 남기지 않는다
 */
@Injectable()
export class KakaoAuthClient {
  private readonly logger = new Logger(KakaoAuthClient.name);
  private readonly restKey: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly adminKey: string | undefined;

  constructor(config: ConfigService) {
    this.restKey = config.get<string>('KAKAO_REST_API_KEY') || undefined;
    this.clientSecret = config.get<string>('KAKAO_CLIENT_SECRET') || undefined;
    this.adminKey = config.get<string>('KAKAO_ADMIN_KEY') || undefined;
    const missing = [
      ['KAKAO_REST_API_KEY', this.restKey],
      ['KAKAO_CLIENT_SECRET', this.clientSecret],
      ['KAKAO_ADMIN_KEY', this.adminKey],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      this.logger.warn(
        `${missing.join('·')}가 없어 카카오 로그인·탈퇴가 실패합니다. 저장소 루트 .env를 확인하세요`,
      );
    }
  }

  /**
   * 인가 코드를 카카오 액세스 토큰으로 바꾼다. redirectUri는 인가 요청 때 쓴 값과 같아야 한다.
   * 코드가 만료·재사용됐거나 주소가 달라 카카오가 거부하면(`invalid_grant`, KOE320·KOE303) 401, 그 밖의 실패는 502
   */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    if (!this.restKey || !this.clientSecret) {
      throw externalApiError(LOGIN_FAILURE_MESSAGE);
    }
    const reply = await this.call(
      '토큰 받기',
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': FORM_CONTENT_TYPE },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.restKey,
          redirect_uri: redirectUri,
          code,
          client_secret: this.clientSecret,
        }).toString(),
      },
      LOGIN_FAILURE_MESSAGE,
    );

    const body = parseJson(reply.text) as {
      access_token?: unknown;
      error?: unknown;
      error_code?: unknown;
    } | null;
    if (reply.ok && typeof body?.access_token === 'string') {
      return body.access_token;
    }
    if (
      reply.status >= 400 &&
      reply.status < 500 &&
      body?.error === 'invalid_grant'
    ) {
      // 사용자가 다시 로그인하면 풀리는 경우라 경고가 아니라 기록만 남긴다
      this.logger.log(`카카오 토큰 받기 거부: ${codeText(body.error_code)}`);
      throw unauthorized(RETRY_LOGIN_MESSAGE);
    }
    this.logger.warn(
      `카카오 토큰 받기 HTTP ${reply.status}: ${codeText(body?.error)} ${codeText(body?.error_code)}`.trim(),
    );
    throw externalApiError(LOGIN_FAILURE_MESSAGE);
  }

  /** 카카오 액세스 토큰으로 회원번호·닉네임을 받는다. 닉네임이 비면 "등대 회원" */
  async getProfile(kakaoAccessToken: string): Promise<KakaoProfile> {
    const reply = await this.call(
      '사용자 정보',
      USER_ME_URL,
      { headers: { Authorization: `Bearer ${kakaoAccessToken}` } },
      LOGIN_FAILURE_MESSAGE,
    );
    const body = reply.ok
      ? (parseJsonKeepingId(reply.text) as {
          id?: unknown;
          kakao_account?: { profile?: { nickname?: unknown } };
        } | null)
      : null;
    if (typeof body?.id !== 'string' || !/^[0-9]+$/.test(body.id)) {
      this.logger.warn(
        `카카오 사용자 정보 HTTP ${reply.status}: 회원번호 없음`,
      );
      throw externalApiError(LOGIN_FAILURE_MESSAGE);
    }
    const nickname = body.kakao_account?.profile?.nickname;
    return {
      providerId: body.id,
      nickname:
        typeof nickname === 'string' && nickname.trim() !== ''
          ? nickname.trim()
          : DEFAULT_NICKNAME,
    };
  }

  /**
   * 어드민 키로 그 회원의 카카오 연결을 끊는다 (탈퇴). 사용자가 카카오에서 이미 끊었으면(-101) `not_linked`.
   * 그 밖의 실패는 502라서 호출하는 쪽은 DB를 지우지 않고 다시 시도하게 한다
   */
  async unlink(providerId: string): Promise<'unlinked' | 'not_linked'> {
    if (!this.adminKey) throw externalApiError(UNLINK_FAILURE_MESSAGE);
    const reply = await this.call(
      '연결 끊기',
      UNLINK_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `KakaoAK ${this.adminKey}`,
          'Content-Type': FORM_CONTENT_TYPE,
        },
        body: new URLSearchParams({
          target_id_type: 'user_id',
          target_id: providerId,
        }).toString(),
      },
      UNLINK_FAILURE_MESSAGE,
    );
    if (reply.ok) return 'unlinked';

    const body = parseJson(reply.text) as { code?: unknown } | null;
    if (reply.status === 400 && body?.code === -101) return 'not_linked';
    this.logger.warn(
      `카카오 연결 끊기 HTTP ${reply.status}: ${codeText(body?.code)}`.trim(),
    );
    throw externalApiError(UNLINK_FAILURE_MESSAGE);
  }

  /** 카카오를 부르고 본문을 문자열로 받는다. 연결 실패·시간 초과는 502로 던진다 */
  private async call(
    label: string,
    url: string,
    init: RequestInit,
    failureMessage: string,
  ): Promise<KakaoReply> {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: res.status, ok: res.ok, text: await res.text() };
    } catch (e) {
      this.logger.warn(`카카오 ${label} 호출 실패: ${errorText(e)}`);
      throw externalApiError(failureMessage);
    }
  }
}

/** JSON이면 객체, 아니면 null */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** JSON.parse reviver의 세 번째 인자 (Node 22의 JSON.parse source text access). 타입 정의에 아직 없어 따로 적는다 */
type ReviverContext = { source?: string };

/**
 * 사용자 정보 JSON을 해석하되 `id`는 원문 숫자 그대로 문자열로 둔다.
 * 카카오 회원번호는 Long이라 2^53을 넘으면 Number로 바꾸는 순간 끝자리가 달라진다
 */
function parseJsonKeepingId(text: string): unknown {
  const reviver = (key: string, value: unknown, context?: ReviverContext) =>
    key === 'id' && typeof value === 'number'
      ? (context?.source ?? String(value))
      : value;
  try {
    return JSON.parse(
      text,
      reviver as (this: unknown, key: string, value: unknown) => unknown,
    ) as unknown;
  } catch {
    return null;
  }
}

/** 카카오 에러 코드(`KOE320`, `-101` 등)를 로그용 문자열로. 다른 형태는 남기지 않는다 */
function codeText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

/** 로그에 남길 에러 문장 */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
