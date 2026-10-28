import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LatLng } from '../../../../shared/types.js';
import { ApiException } from '../common/api-exception.js';

const WALK_URL = 'https://dapi.kakao.com/v2/routing/walk';

/** 카카오가 이 시간 안에 답하지 않으면 실패로 본다 (ms) */
const TIMEOUT_MS = 5000;

/** 카카오 도보 경로 탐색 옵션 (docs/EXTERNAL_APIS.md) */
export type KakaoRouteMode = 'SHORTEST' | 'BROAD_FIRST' | 'ACCESSIBLE';

/**
 * 도보 경로 응답 — 공식 문서 기준, 쓰는 필드만.
 * 경로를 못 찾아도 HTTP 200이고 `status`로 이유를 알려 준다 (2026-10-25 실제 호출로 확인)
 */
export type KakaoWalkResponse = {
  /** OK, SAME_POINT, START_LINK_NOT_FOUND, END_LINK_NOT_FOUND, TOO_MANY_SEARCH_LINK, TOO_FAR_AWAY, ROUTE_RESULT_NOT_FOUND */
  status: string;
  route?: {
    properties: { totalDistance: number; totalTime: number };
    legs: { steps: { path: { points: [number, number][] } }[] }[];
  };
};

const FAILURE_MESSAGE =
  '경로 검색이 잠시 안 되고 있어요. 잠시 후 다시 시도해 주세요';
const QUOTA_MESSAGE =
  '오늘은 경로 검색이 많아 더 찾을 수 없어요. 잠시 후 다시 시도해 주세요';

/**
 * 카카오 도보 경로 API 호출 (`GET /v2/routing/walk`).
 * 티맵으로 바꿀 때는 이 파일과 `kakao-walk.convert.ts`만 바꾼다 (CLAUDE.md).
 * HTTP 단계 실패만 여기서 에러로 바꾸고, 경로 결과(`status`)는 그대로 돌려준다
 */
@Injectable()
export class KakaoWalkClient {
  private readonly logger = new Logger(KakaoWalkClient.name);
  private readonly restKey: string | undefined;

  constructor(config: ConfigService) {
    this.restKey = config.get<string>('KAKAO_REST_API_KEY') || undefined;
  }

  /**
   * 출발 → 도착 도보 경로를 한 번 부른다.
   * 키 없음·연결 실패·시간 초과·응답 형식 오류는 502, 하루 한도 초과는 503 QUOTA_EXCEEDED
   */
  async walk(
    origin: LatLng,
    destination: LatLng,
    routeMode: KakaoRouteMode,
  ): Promise<KakaoWalkResponse> {
    if (!this.restKey) {
      this.logger.warn(
        'KAKAO_REST_API_KEY가 없어 경로를 찾을 수 없습니다. 저장소 루트 .env를 확인하세요',
      );
      throw failure();
    }

    // 카카오 좌표는 x = 경도, y = 위도
    const params = new URLSearchParams({
      start_x: String(origin.lng),
      start_y: String(origin.lat),
      end_x: String(destination.lng),
      end_y: String(destination.lat),
      route_mode: routeMode,
    });

    let res: Response;
    try {
      res = await fetch(`${WALK_URL}?${params.toString()}`, {
        headers: { Authorization: `KakaoAK ${this.restKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      // 출발·도착 좌표는 남기지 않는다 (집 주소일 수 있음)
      this.logger.warn(`카카오 도보 경로 호출 실패: ${errorText(e)}`);
      throw failure();
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      this.logger.warn(
        `카카오 도보 경로 HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
      throw isQuotaExceeded(res.status, text) ? quotaExceeded() : failure();
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (e) {
      this.logger.warn(`카카오 도보 경로 응답 해석 실패: ${errorText(e)}`);
      throw failure();
    }
    if (typeof (body as KakaoWalkResponse | null)?.status !== 'string') {
      this.logger.warn('카카오 도보 경로 응답에 status가 없습니다');
      throw failure();
    }
    return body as KakaoWalkResponse;
  }
}

/**
 * 하루 한도를 넘긴 응답인지. 카카오 공통 에러 문서 기준으로
 * HTTP 429(로컬 API 등의 쿼터 초과)와 HTTP 400 + `code: -10`(허용된 요청 횟수 초과) 둘 다 본다
 */
function isQuotaExceeded(status: number, text: string): boolean {
  if (status === 429) return true;
  if (status !== 400) return false;
  try {
    return (JSON.parse(text) as { code?: unknown }).code === -10;
  } catch {
    return false;
  }
}

/** 502 EXTERNAL_API_ERROR */
function failure(): ApiException {
  return new ApiException(
    HttpStatus.BAD_GATEWAY,
    'EXTERNAL_API_ERROR',
    FAILURE_MESSAGE,
  );
}

/** 503 QUOTA_EXCEEDED (API.md 공통 규칙) */
function quotaExceeded(): ApiException {
  return new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'QUOTA_EXCEEDED',
    QUOTA_MESSAGE,
  );
}

/** 로그에 남길 에러 문장 */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
