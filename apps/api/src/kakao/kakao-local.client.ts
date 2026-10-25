import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LatLng } from '../../../../shared/types.js';
import { externalApiError } from '../common/api-exception.js';

const BASE_URL = 'https://dapi.kakao.com/v2/local/search';

/** 카카오가 이 시간 안에 답하지 않으면 실패로 본다 (ms) */
const TIMEOUT_MS = 5000;

const FAILURE_MESSAGE =
  '장소 검색이 잠시 안 되고 있어요. 잠시 후 다시 시도해 주세요';

/** 키워드 검색 응답의 장소 하나 — 공식 문서 기준, 쓰는 필드만 */
export type KakaoKeywordDoc = {
  id: string;
  place_name: string;
  /** 지번 주소. 항상 있다 */
  address_name: string;
  /** 도로명 주소. 없으면 빈 문자열 (주차장·정류장 등) */
  road_address_name: string;
  /** 경도 */
  x: string;
  /** 위도 */
  y: string;
};

/** 주소 검색 응답의 주소 하나 — 공식 문서 기준, 쓰는 필드만 */
export type KakaoAddressDoc = {
  /** 검색어에 맞은 주소 (도로명이나 지번) */
  address_name: string;
  x: string;
  y: string;
};

export type KeywordSearchOptions = {
  /** 이 사각형 안에서만 찾는다 */
  rect?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  /** 있으면 이 좌표에서 가까운 곳을 우선 (정확도순은 그대로) */
  near?: LatLng;
  /** 1~15 */
  size?: number;
};

/**
 * 카카오 로컬 API(키워드·주소 검색) 호출 (API.md 2장 `/places`).
 * REST 키는 서버 환경변수로만 쓴다 (CLAUDE.md). 실패는 모두 502 EXTERNAL_API_ERROR로 바꾼다
 */
@Injectable()
export class KakaoLocalClient {
  private readonly logger = new Logger(KakaoLocalClient.name);
  private readonly restKey: string | undefined;

  constructor(config: ConfigService) {
    this.restKey = config.get<string>('KAKAO_REST_API_KEY') || undefined;
    if (!this.restKey) {
      this.logger.warn(
        'KAKAO_REST_API_KEY가 없어 장소 검색이 실패합니다. 저장소 루트 .env를 확인하세요',
      );
    }
  }

  /** 키워드로 장소를 찾는다. 정렬은 카카오 기본 정확도순이고, `near`가 있으면 가까운 곳을 우선한다 */
  async searchKeyword(
    query: string,
    options: KeywordSearchOptions = {},
  ): Promise<KakaoKeywordDoc[]> {
    const params = new URLSearchParams({ query });
    if (options.size) params.set('size', String(options.size));
    const { rect, near } = options;
    if (rect) {
      // 카카오 rect는 "좌측 X,좌측 Y,우측 X,우측 Y" — 경도가 먼저다
      params.set(
        'rect',
        [rect.minLng, rect.minLat, rect.maxLng, rect.maxLat].join(','),
      );
    }
    if (near) {
      // sort=distance는 쓰지 않는다. 순수 거리순이면 "우송대학교"에 수영장·체육관이 본 건물보다
      // 먼저 나와서, x·y만 주고 정확도순에 위치를 반영하게 한다 (2026-10-25 카카오 응답으로 비교)
      params.set('x', String(near.lng));
      params.set('y', String(near.lat));
    }
    const body = await this.get<{ documents: KakaoKeywordDoc[] }>(
      'keyword',
      params,
    );
    return body.documents;
  }

  /** 주소로 좌표를 찾는다. 지역 제한 파라미터가 없어 전국 결과가 온다 */
  async searchAddress(query: string, size = 30): Promise<KakaoAddressDoc[]> {
    const params = new URLSearchParams({ query, size: String(size) });
    const body = await this.get<{ documents: KakaoAddressDoc[] }>(
      'address',
      params,
    );
    return body.documents;
  }

  /** 카카오 로컬 API를 부른다. 키 없음·연결 실패·시간 초과·2xx 아닌 응답은 502로 던진다 */
  private async get<T>(path: string, params: URLSearchParams): Promise<T> {
    if (!this.restKey) throw externalApiError(FAILURE_MESSAGE);

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${path}.json?${params.toString()}`, {
        headers: { Authorization: `KakaoAK ${this.restKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      // 검색어·좌표는 남기지 않는다 (사용자 위치가 들어 있을 수 있음)
      this.logger.warn(`카카오 ${path} 검색 호출 실패: ${errorText(e)}`);
      throw externalApiError(FAILURE_MESSAGE);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(
        `카카오 ${path} 검색 HTTP ${res.status}: ${detail.slice(0, 200)}`,
      );
      throw externalApiError(FAILURE_MESSAGE);
    }

    try {
      return (await res.json()) as T;
    } catch (e) {
      this.logger.warn(`카카오 ${path} 검색 응답 해석 실패: ${errorText(e)}`);
      throw externalApiError(FAILURE_MESSAGE);
    }
  }
}

/** 로그에 남길 에러 문장 */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
