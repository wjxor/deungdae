import type { Logger } from '@nestjs/common';
import { externalApiError } from './api-exception.js';

/** 외부 API가 이 시간 안에 답하지 않으면 실패로 본다 (ms) */
export const EXTERNAL_TIMEOUT_MS = 5000;

/** 폼 본문을 보낼 때의 Content-Type */
export const FORM_CONTENT_TYPE =
  'application/x-www-form-urlencoded;charset=utf-8';

/** 외부 API 응답 한 번. 본문은 문자열로 받아 부르는 쪽이 해석한다 */
export type ExternalReply = { status: number; ok: boolean; text: string };

/**
 * 외부 API를 부르고 본문을 문자열로 받는다. 연결 실패·시간 초과는 로그를 남기고 502로 던진다.
 * 로그에는 `label`과 에러 문장만 남긴다 — 키·토큰은 URL이 아니라 헤더·본문으로 보내서 에러 문장에 들어가지 않는다.
 * 네이버·구글 로그인이 쓴다 (카카오 로그인은 `KakaoAuthClient` 안에 같은 동작이 있다)
 */
export async function callExternal(
  logger: Logger,
  label: string,
  url: string,
  init: RequestInit,
  failureMessage: string,
): Promise<ExternalReply> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });
    return { status: res.status, ok: res.ok, text: await res.text() };
  } catch (e) {
    logger.warn(
      `${label} 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
    );
    throw externalApiError(failureMessage);
  }
}

/** JSON이면 객체, 아니면 null */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 외부 API 에러 코드(`invalid_grant`, `-101` 등)를 로그용 문자열로. 다른 형태는 남기지 않는다 */
export function codeText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}
