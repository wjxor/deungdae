import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  Route,
  RouteSearchRequest,
  RouteSearchResponse,
  RouteType,
  Segment,
} from '../../../../shared/types.js';
import { ApiException } from '../common/api-exception.js';
import { isInDaejeonRect } from '../common/daejeon.js';
import type { KakaoRouteMode } from '../walk/kakao-walk.client.js';
import type { WalkRoute } from '../walk/kakao-walk.convert.js';
import { WalkRouteService } from '../walk/walk-route.service.js';
import {
  pickSafe,
  toRouteScore,
  toSafetyLevel,
  toSegmentScore,
} from './safety.js';
import { SafetyScoreService } from './safety-score.service.js';
import { splitPath } from './segments.js';

/**
 * 안심경로 후보로 더 부르는 카카오 `route_mode`. 편안한 길(`ACCESSIBLE`)은 귀갓길 60쌍 중 최단·넓은 길 우선 둘 다와
 * 다른 길인 쌍이 8쌍뿐이고, 빼도 고르는 결과가 같아서 부르지 않는다 (docs/safety-score-experiment.md). 검색 1회에 도보 API 2건
 */
const SAFE_CANDIDATE_MODES: readonly KakaoRouteMode[] = ['BROAD_FIRST'];

/** 구간 점수까지 매긴 후보 경로 */
type ScoredRoute = {
  walk: WalkRoute;
  distanceM: number;
  safetyScore: number;
  segments: Segment[];
};

/**
 * 경로 검색 (API.md 3장, FR-004·006·007). 안심경로는 B안 — 카카오 `route_mode` 후보를 구간별 안전점수로 비교한다.
 * 1. 최단(`SHORTEST`)과 넓은 길 우선(`BROAD_FIRST`)을 함께 부른다
 * 2. 후보마다 약 50m 구간으로 나눠 반경 30m 안 시설로 점수를 매긴다
 * 3. 최단보다 5점 이상 높고 20% 넘게 돌아가지 않는 후보가 있으면 안심경로, 없으면 최단경로가 곧 안심경로(`sameRoute`)
 */
@Injectable()
export class RoutesService {
  constructor(
    private readonly walk: WalkRouteService,
    private readonly scores: SafetyScoreService,
  ) {}

  /** 출발 → 도착 최단·안심 경로. `mode`는 추천(`recommended`)만 바꾼다 */
  async search(req: RouteSearchRequest): Promise<RouteSearchResponse> {
    if (!isInDaejeonRect(req.origin) || !isInDaejeonRect(req.destination)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'OUT_OF_AREA',
        '대전에서만 쓸 수 있어요. 출발지와 도착지를 대전 안에서 골라 주세요',
      );
    }

    const walks = await this.findCandidates(req);
    const [shortest, ...others] = await this.score(walks);
    const safe = pickSafe(shortest, others);
    return {
      recommended: req.mode === 'night' ? 'safe' : 'shortest',
      routes: [toRoute('shortest', shortest), toRoute('safe', safe)],
      sameRoute: safe === shortest,
    };
  }

  /**
   * 최단경로와 안심경로 후보를 함께 부른다 (첫 번째가 최단). 최단경로가 실패하면 그 에러를 그대로 던진다.
   * 후보만 못 찾았으면(4xx) 그 후보를 빼고, 한도 초과·카카오 장애(5xx)는 최단경로만 보여 주지 않고 에러로 알린다
   */
  private async findCandidates(req: RouteSearchRequest): Promise<WalkRoute[]> {
    const [shortest, ...others] = await Promise.allSettled([
      this.walk.find(req.origin, req.destination, 'SHORTEST'),
      ...SAFE_CANDIDATE_MODES.map((mode) =>
        this.walk.find(req.origin, req.destination, mode),
      ),
    ]);
    if (shortest.status === 'rejected') throw shortest.reason;

    const found = [shortest.value];
    for (const result of others) {
      if (result.status === 'fulfilled') found.push(result.value);
      else if (!isClientError(result.reason)) throw result.reason;
    }
    return found;
  }

  /** 후보마다 구간을 나누고, 모든 구간의 원점수를 한 번에 받아 점수를 매긴다 */
  private async score(walks: WalkRoute[]): Promise<ScoredRoute[]> {
    const pieces = walks.map((w) => splitPath(w.path));
    const raws = await this.scores.rawScores(
      pieces.flat().map((piece) => piece.path),
    );

    let next = 0;
    return walks.map((walk, k) => {
      const segments = pieces[k].map((piece) => {
        const safetyScore = toSegmentScore(raws[next++]);
        return { ...piece, safetyScore, level: toSafetyLevel(safetyScore) };
      });
      return {
        walk,
        distanceM: walk.distanceM,
        safetyScore: toRouteScore(segments),
        segments,
      };
    });
  }
}

/** 4xx ApiException인지 (그 후보로는 경로를 못 찾음) */
function isClientError(e: unknown): boolean {
  return e instanceof ApiException && e.getStatus() < 500;
}

/** 점수를 매긴 후보를 응답의 `Route`로. 경로 등급도 구간과 같은 기준이라 화면이 기준값을 따로 두지 않는다 */
function toRoute(type: RouteType, route: ScoredRoute): Route {
  return {
    type,
    distanceM: route.walk.distanceM,
    durationS: route.walk.durationS,
    safetyScore: route.safetyScore,
    level: toSafetyLevel(route.safetyScore),
    path: route.walk.path,
    segments: route.segments,
  };
}
