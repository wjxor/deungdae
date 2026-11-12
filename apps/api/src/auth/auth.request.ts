import type { KakaoLoginRequest } from '../../../../shared/types.js';
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

/** 공백만 있지 않은 문자열인지 */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
