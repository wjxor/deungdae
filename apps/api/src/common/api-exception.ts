import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiError, ErrorCode } from '../../../../shared/types.js';

/**
 * API.md 공통 규칙의 에러 응답(`{ error: { code, message } }`)을 내는 예외.
 * Nest 기본 예외 처리가 이 본문을 그대로 JSON으로 보내서 따로 필터를 두지 않는다
 */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: ErrorCode, message: string) {
    const body: ApiError = { error: { code, message } };
    super(body, status);
  }
}

/** 400 INVALID_INPUT — 필수 값 누락, 형식 오류 */
export function invalidInput(message: string): ApiException {
  return new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_INPUT', message);
}

/** 502 EXTERNAL_API_ERROR — 카카오·천문연 API 실패·응답 없음, 시설 조회 중 DB 실패 */
export function externalApiError(message: string): ApiException {
  return new ApiException(
    HttpStatus.BAD_GATEWAY,
    'EXTERNAL_API_ERROR',
    message,
  );
}
