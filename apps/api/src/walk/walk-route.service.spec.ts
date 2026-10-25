import {
  DAEJEON_STATION,
  WALK_OK,
  WOOSONG,
  walkFailed,
} from '../../test/fixtures/kakao-walk.js';
import { ApiException } from '../common/api-exception.js';
import type {
  KakaoWalkClient,
  KakaoWalkResponse,
} from './kakao-walk.client.js';
import type { RouteCacheService } from './route-cache.service.js';
import { WalkRouteService } from './walk-route.service.js';

/** 가짜 카카오와 메모리 캐시로 만든 WalkRouteService */
function setup(kakaoResponse: () => Promise<KakaoWalkResponse>) {
  const walk = vi.fn(kakaoResponse);
  const store = new Map<string, unknown>();
  const cache = {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    put: vi.fn((entry: { key: string; response: unknown }) => {
      store.set(entry.key, entry.response);
      return Promise.resolve();
    }),
  };
  const service = new WalkRouteService(
    { walk } as unknown as KakaoWalkClient,
    cache as unknown as RouteCacheService,
  );
  return { service, walk, cache, store };
}

const ok = () => Promise.resolve(WALK_OK);

describe('WalkRouteService', () => {
  it('카카오에는 소수점 4자리로 반올림한 좌표를 보내고, 성공하면 캐시에 넣는다', async () => {
    const { service, walk, cache } = setup(ok);
    const route = await service.find(DAEJEON_STATION, WOOSONG, 'SHORTEST');

    expect(route.path).toHaveLength(17);
    expect(walk).toHaveBeenCalledWith(
      { lat: 36.3323, lng: 127.4346 },
      { lat: 36.3371, lng: 127.4451 },
      'SHORTEST',
    );
    expect(cache.put).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kakao',
        routeMode: 'SHORTEST',
        response: WALK_OK,
        distanceM: 342,
        durationS: 335,
      }),
    );
  });

  it('두 번째 같은 요청은 캐시로 답하고 카카오를 부르지 않는다 (10m 안 차이도 같은 요청)', async () => {
    const { service, walk } = setup(ok);
    await service.find(DAEJEON_STATION, WOOSONG, 'SHORTEST');
    const nearby = { lat: 36.33231, lng: 127.43462 };
    const again = await service.find(nearby, WOOSONG, 'SHORTEST');
    expect(again.distanceM).toBe(342);
    expect(walk).toHaveBeenCalledOnce();
  });

  it('같은 요청이 동시에 오면 카카오를 한 번만 부른다', async () => {
    let resolveWalk!: (res: KakaoWalkResponse) => void;
    const { service, walk } = setup(
      () => new Promise((resolve) => (resolveWalk = resolve)),
    );
    const first = service.find(DAEJEON_STATION, WOOSONG, 'SHORTEST');
    const second = service.find(DAEJEON_STATION, WOOSONG, 'SHORTEST');
    // 캐시 조회(비동기)가 끝나 카카오 호출까지 가도록 기다린다
    await vi.waitFor(() => expect(walk).toHaveBeenCalled());
    resolveWalk(WALK_OK);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(walk).toHaveBeenCalledOnce();
  });

  it('route_mode가 다르면 따로 부른다', async () => {
    const { service, walk } = setup(ok);
    await service.find(DAEJEON_STATION, WOOSONG, 'SHORTEST');
    await service.find(DAEJEON_STATION, WOOSONG, 'BROAD_FIRST');
    expect(walk).toHaveBeenCalledTimes(2);
  });

  it('경로를 못 찾으면 에러 코드로 던지고 캐시하지 않는다. 다음 요청은 다시 부른다', async () => {
    const { service, walk, cache } = setup(() =>
      Promise.resolve(walkFailed('START_LINK_NOT_FOUND')),
    );
    for (let i = 0; i < 2; i++) {
      const e = await service
        .find(DAEJEON_STATION, WOOSONG, 'SHORTEST')
        .catch((err: unknown) => err);
      expect(e).toBeInstanceOf(ApiException);
      expect((e as ApiException).getResponse()).toMatchObject({
        error: { code: 'ORIGIN_UNREACHABLE' },
      });
    }
    expect(cache.put).not.toHaveBeenCalled();
    expect(walk).toHaveBeenCalledTimes(2);
  });

  it('반올림하면 같은 점이면 카카오를 부르지 않고 400 INVALID_INPUT', async () => {
    const { service, walk } = setup(ok);
    const e = await service
      .find(DAEJEON_STATION, { lat: 36.33231, lng: 127.43462 }, 'SHORTEST')
      .catch((err: unknown) => err);
    expect((e as ApiException).getStatus()).toBe(400);
    expect(walk).not.toHaveBeenCalled();
  });

  it('캐시에 든 응답 형식이 틀리면 버리고 카카오를 다시 부른다', async () => {
    const { service, walk, store } = setup(ok);
    await service.find(DAEJEON_STATION, WOOSONG, 'SHORTEST');
    const [key] = store.keys();
    store.set(key, { status: 'OK', route: { legs: 'broken' } });

    const route = await service.find(DAEJEON_STATION, WOOSONG, 'SHORTEST');
    expect(route.path).toHaveLength(17);
    expect(walk).toHaveBeenCalledTimes(2);
  });
});
