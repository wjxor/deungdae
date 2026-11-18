import type {
  KakaoLoginRequest,
  SocialLoginRequest,
} from '../../../../shared/types.js';
import { invalidInput } from '../common/api-exception.js';

/**
 * `POST /auth/kakao` 본문을 검사한다 (API.md 5장 `KakaoLoginRequest`).
 * code·redirectUri가 비지 않은 문자열이 아니면 400 INVALID_INPUT. 허용된 주소인지는 AuthService가 본다
 */
export function parseKakaoLoginRequest(body: unknown): KakaoLoginRequest {
  const { code, redirectUri } = (
    typeof body === 'object' && body !== null ? body : {}
  ) as Record<string, unknown>;
  if (!isFilled(code) || !isFilled(redirectUri)) {
    throw invalidInput('로그인 요청 형식이 올바르지 않아요');
  }
  return { code, redirectUri };
}

/**
 * `POST /auth/naver`·`/auth/google` 본문을 검사한다 (API.md 5장 `SocialLoginRequest`).
 * code·redirectUri는 비지 않은 문자열이어야 하고, state는 없거나 비지 않은 문자열이어야 한다. 아니면 400 INVALID_INPUT
 */
export function parseSocialLoginRequest(body: unknown): SocialLoginRequest {
  const fields = asRecord(body);
  const { code, redirectUri } = parseKakaoLoginRequest(fields);
  const { state } = fields;
  if (state === undefined) return { code, redirectUri };
  if (!isFilled(state)) {
    throw invalidInput('로그인 요청 형식이 올바르지 않아요');
  }
  return { code, redirectUri, state };
}

/**
 * `DELETE /auth/me` 본문. 카카오 회원 탈퇴는 본문이 없어 null이고,
 * 네이버·구글 회원은 다시 로그인해 받은 코드를 `SocialLoginRequest` 모양으로 넘긴다
 */
export function parseDeleteAccountRequest(
  body: unknown,
): SocialLoginRequest | null {
  const fields = asRecord(body);
  const { code, redirectUri, state } = fields;
  if (code === undefined && redirectUri === undefined && state === undefined) {
    return null;
  }
  return parseSocialLoginRequest(fields);
}

/** 객체면 그대로, 아니면 빈 객체 */
function asRecord(body: unknown): Record<string, unknown> {
  return (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
}

/** 공백만 있지 않은 문자열인지 */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
