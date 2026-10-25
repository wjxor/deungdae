import { HttpStatus } from '@nestjs/common';
import type { ErrorCode, LatLng } from '../../../../shared/types.js';
import { ApiException } from '../common/api-exception.js';
import type { KakaoWalkResponse } from './kakao-walk.client.js';

/** 경로 API 하나의 결과를 공급자(카카오·티맵)와 관계없이 쓰는 모양 */
export type WalkRoute = {
  distanceM: number;
  durationS: number;
  /** 출발 → 도착 순서의 좌표. 같은 점이 연달아 나오지 않는다 */
  path: LatLng[];
};

/** 카카오 `status` → API.md 에러 (공통 규칙의 에러 표) */
const STATUS_ERRORS: Record<
  string,
  { status: HttpStatus; code: ErrorCode; message: string }
> = {
  SAME_POINT: {
    status: HttpStatus.BAD_REQUEST,
    code: 'INVALID_INPUT',
    message: '출발지와 도착지가 같아요',
  },
  TOO_FAR_AWAY: {
    status: HttpStatus.BAD_REQUEST,
    code: 'TOO_FAR',
    message: '출발지와 도착지가 너무 멀어서 도보 경로를 찾을 수 없어요',
  },
  START_LINK_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    code: 'ORIGIN_UNREACHABLE',
    message:
      '출발지 근처에서 걸을 수 있는 길을 찾지 못했어요. 출발지를 조금 옮겨 주세요',
  },
  END_LINK_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    code: 'DESTINATION_UNREACHABLE',
    message:
      '도착지 근처에서 걸을 수 있는 길을 찾지 못했어요. 도착지를 조금 옮겨 주세요',
  },
};

/** 위 표에 없는 status(ROUTE_RESULT_NOT_FOUND, TOO_MANY_SEARCH_LINK 등) */
const ROUTE_NOT_FOUND = {
  status: HttpStatus.NOT_FOUND,
  code: 'ROUTE_NOT_FOUND',
  message: '경로를 찾지 못했어요. 출발지나 도착지를 바꿔 다시 시도해 주세요',
} as const;

/**
 * 카카오 도보 경로 응답을 `WalkRoute`로 바꾼다.
 * `status`가 OK가 아니거나 경로 좌표가 2개보다 적으면 API.md 에러 코드로 던진다
 */
export function toWalkRoute(res: KakaoWalkResponse): WalkRoute {
  if (res.status !== 'OK') {
    const e = STATUS_ERRORS[res.status] ?? ROUTE_NOT_FOUND;
    throw new ApiException(e.status, e.code, e.message);
  }

  const path: LatLng[] = [];
  for (const leg of res.route?.legs ?? []) {
    for (const step of leg.steps) {
      for (const [x, y] of step.path.points) {
        // 앞 step의 끝점이 다음 step의 첫 점으로 다시 나와서 연달아 같은 점은 하나만 둔다
        const last = path.at(-1);
        if (last && last.lat === y && last.lng === x) continue;
        path.push({ lat: y, lng: x });
      }
    }
  }
  if (path.length < 2 || !res.route) {
    throw new ApiException(
      ROUTE_NOT_FOUND.status,
      ROUTE_NOT_FOUND.code,
      ROUTE_NOT_FOUND.message,
    );
  }

  return {
    distanceM: res.route.properties.totalDistance,
    durationS: res.route.properties.totalTime,
    path,
  };
}
