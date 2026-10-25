import { Injectable, Logger } from '@nestjs/common';
import type { LatLng } from '../../../../shared/types.js';
import { invalidInput } from '../common/api-exception.js';
import {
  KakaoWalkClient,
  type KakaoRouteMode,
  type KakaoWalkResponse,
} from './kakao-walk.client.js';
import { toWalkRoute, type WalkRoute } from './kakao-walk.convert.js';
import {
  RouteCacheService,
  roundLatLng,
  routeCacheKey,
} from './route-cache.service.js';

const PROVIDER = 'kakao';

/**
 * 도보 경로 하나를 찾는다 (FR-004·006). 같은 요청은 카카오를 한 번만 부른다.
 * - 좌표를 소수점 4자리로 반올림해 캐시 키와 카카오 호출에 같이 쓴다
 * - DB 캐시(`route_cache`, 24시간)에 있으면 카카오를 부르지 않는다. 한도를 넘긴 날에도 캐시에 있는 요청은 답한다
 * - 같은 요청이 동시에 오면 먼저 온 호출 하나를 같이 기다린다 (서버 한 대 안에서)
 */
@Injectable()
export class WalkRouteService {
  private readonly logger = new Logger(WalkRouteService.name);

  /** 진행 중인 호출. 캐시 키 → 결과 */
  private readonly inFlight = new Map<string, Promise<WalkRoute>>();

  constructor(
    private readonly kakao: KakaoWalkClient,
    private readonly cache: RouteCacheService,
  ) {}

  /** 출발 → 도착 도보 경로. 실패는 API.md 에러 코드(ApiException)로 던진다 */
  find(
    origin: LatLng,
    destination: LatLng,
    routeMode: KakaoRouteMode,
  ): Promise<WalkRoute> {
    const start = roundLatLng(origin);
    const end = roundLatLng(destination);
    if (start.lat === end.lat && start.lng === end.lng) {
      // 카카오도 SAME_POINT로 답하지만 한도를 쓰지 않게 먼저 거른다
      return Promise.reject(invalidInput('출발지와 도착지가 같아요'));
    }

    const key = routeCacheKey({
      provider: PROVIDER,
      routeMode,
      origin: start,
      destination: end,
      waypoints: [],
    });
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const loading = this.load(key, start, end, routeMode).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, loading);
    return loading;
  }

  /** 캐시에서 찾고, 없으면 카카오를 불러 성공한 응답만 캐시에 넣는다 */
  private async load(
    key: string,
    origin: LatLng,
    destination: LatLng,
    routeMode: KakaoRouteMode,
  ): Promise<WalkRoute> {
    const cached = await this.cache.get(key);
    if (cached) {
      try {
        return toWalkRoute(cached as KakaoWalkResponse);
      } catch {
        // 저장된 응답 형식이 틀리면 버리고 다시 부른다 (OK 응답만 저장하므로 보통은 없음)
        this.logger.warn('경로 캐시 응답 형식이 맞지 않아 다시 부릅니다');
      }
    }

    const res = await this.kakao.walk(origin, destination, routeMode);
    // OK가 아니면 여기서 에러로 던지고 캐시하지 않는다
    const route = toWalkRoute(res);
    await this.cache.put({
      key,
      provider: PROVIDER,
      routeMode,
      response: res,
      distanceM: route.distanceM,
      durationS: route.durationS,
    });
    return route;
  }
}
