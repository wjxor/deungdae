import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  Route,
  RouteSearchRequest,
  RouteSearchResponse,
  RouteType,
} from '../../../../shared/types.js';
import { ApiException } from '../common/api-exception.js';
import { isInDaejeonRect } from '../common/daejeon.js';
import type { WalkRoute } from '../walk/kakao-walk.convert.js';
import { WalkRouteService } from '../walk/walk-route.service.js';
import { toSafetyLevel } from './safety.js';
import { splitPath } from './segments.js';

/**
 * 안전점수 자리. 시설 수로 점수를 매기는 것은 안심경로(B) 작업에서 한다.
 * 정규화 기준이 아직 없고 DB에 시설 데이터도 아직 없어서, 그 전까지는 모든 구간이 0점이다
 */
const UNSCORED = 0;

/**
 * 경로 검색 (API.md 3장, FR-004·007).
 * 지금은 최단경로(카카오 `SHORTEST`)만 계산하고, 안심경로는 최단경로를 그대로 담아 `sameRoute: true`로 답한다.
 * 안심경로(B: route_mode 후보 비교)는 다음 작업
 */
@Injectable()
export class RoutesService {
  constructor(private readonly walk: WalkRouteService) {}

  /** 출발 → 도착 최단·안심 경로. `mode`는 추천(`recommended`)만 바꾼다 */
  async search(req: RouteSearchRequest): Promise<RouteSearchResponse> {
    if (!isInDaejeonRect(req.origin) || !isInDaejeonRect(req.destination)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'OUT_OF_AREA',
        '대전에서만 쓸 수 있어요. 출발지와 도착지를 대전 안에서 골라 주세요',
      );
    }

    const shortest = await this.walk.find(
      req.origin,
      req.destination,
      'SHORTEST',
    );
    return {
      recommended: req.mode === 'night' ? 'safe' : 'shortest',
      routes: [toRoute('shortest', shortest), toRoute('safe', shortest)],
      sameRoute: true,
    };
  }
}

/** 도보 경로 하나를 응답의 `Route`로. 구간은 약 50m씩 */
function toRoute(type: RouteType, walk: WalkRoute): Route {
  const segments = splitPath(walk.path).map((piece) => ({
    ...piece,
    safetyScore: UNSCORED,
    level: toSafetyLevel(UNSCORED),
  }));
  return {
    type,
    distanceM: walk.distanceM,
    durationS: walk.durationS,
    safetyScore: UNSCORED,
    path: walk.path,
    segments,
  };
}
