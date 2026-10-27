import type { LatLng } from '../../../../shared/types.js';
import {
  DAEJEON_STATION,
  WALK_OK,
  WOOSONG,
} from '../../test/fixtures/kakao-walk.js';
import { ApiException } from '../common/api-exception.js';
import type { KakaoRouteMode } from '../walk/kakao-walk.client.js';
import { toWalkRoute, type WalkRoute } from '../walk/kakao-walk.convert.js';
import type { WalkRouteService } from '../walk/walk-route.service.js';
import { RoutesService } from './routes.service.js';
import type { SafetyScoreService } from './safety-score.service.js';
import { splitPath } from './segments.js';

const SHORTEST = toWalkRoute(WALK_OK); // 342m
const SEGMENTS = splitPath(SHORTEST.path).length;
const REQ = {
  origin: DAEJEON_STATION,
  destination: WOOSONG,
  mode: 'night',
} as const;

/** 넓은 길 우선 후보. 모양은 최단과 같게 두고 거리만 바꾼다 (점수는 가짜 원점수로 정함) */
const broad = (distanceM: number): WalkRoute => ({ ...SHORTEST, distanceM });

/**
 * 카카오(route_mode별)와 원점수를 가짜로 둔 RoutesService.
 * 원점수는 앞쪽 구간(최단경로)에 `shortestRaw`, 뒤쪽 구간(넓은 길)에 `broadRaw`를 준다
 */
function setup({
  broadRoute = Promise.resolve(broad(380)) as Promise<WalkRoute>,
  shortestRaw = 1,
  broadRaw = 1,
} = {}) {
  const find = vi.fn(
    (_o: LatLng, _d: LatLng, mode: KakaoRouteMode): Promise<WalkRoute> =>
      mode === 'SHORTEST' ? Promise.resolve(SHORTEST) : broadRoute,
  );
  const rawScores = vi.fn((paths: LatLng[][]) =>
    Promise.resolve(
      paths.map((_, i) => (i < SEGMENTS ? shortestRaw : broadRaw)),
    ),
  );
  const service = new RoutesService(
    { find } as unknown as WalkRouteService,
    { rawScores } as unknown as SafetyScoreService,
  );
  return { service, find, rawScores };
}

/** 던진 ApiException의 HTTP 상태와 code */
async function errorOf(promise: Promise<unknown>) {
  const e = await promise.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(ApiException);
  const body = (e as ApiException).getResponse() as {
    error: { code: string };
  };
  return { status: (e as ApiException).getStatus(), code: body.error.code };
}

describe('RoutesService', () => {
  it('최단·넓은 길 우선을 함께 부르고, 두 후보의 구간 원점수를 쿼리 한 번에 받는다', async () => {
    const { service, find, rawScores } = setup();
    await service.search(REQ);

    expect(find.mock.calls.map((c) => c[2])).toEqual([
      'SHORTEST',
      'BROAD_FIRST',
    ]);
    expect(find).toHaveBeenCalledWith(DAEJEON_STATION, WOOSONG, 'SHORTEST');
    expect(rawScores).toHaveBeenCalledOnce();
    expect(rawScores.mock.calls[0][0]).toHaveLength(SEGMENTS * 2);
  });

  it('넓은 길이 5점 이상 높고 20% 안으로 돌아가면 안심경로', async () => {
    // 원점수 1 → 29점, 5 → 75점. 380m는 342m보다 11% 김
    const { service } = setup({ shortestRaw: 1, broadRaw: 5 });
    const res = await service.search(REQ);

    expect(res.sameRoute).toBe(false);
    expect(res.routes.map((r) => r.type)).toEqual(['shortest', 'safe']);
    const [shortest, safe] = res.routes;
    expect(shortest).toMatchObject({
      distanceM: 342,
      safetyScore: 29,
      level: 'danger',
    });
    expect(safe).toMatchObject({
      distanceM: 380,
      safetyScore: 75,
      level: 'safe',
    });
    expect(shortest.segments).toHaveLength(SEGMENTS);
    for (const s of shortest.segments) {
      expect(s).toMatchObject({ safetyScore: 29, level: 'danger' });
    }
    for (const s of safe.segments) {
      expect(s).toMatchObject({ safetyScore: 75, level: 'safe' });
    }
  });

  it('넓은 길이 4점만 높으면 최단경로가 곧 안심경로 (sameRoute)', async () => {
    // 원점수 9 → 96점, 10 → 100점
    const { service } = setup({ shortestRaw: 9, broadRaw: 10 });
    const res = await service.search(REQ);

    expect(res.sameRoute).toBe(true);
    const [shortest, safe] = res.routes;
    expect({ ...safe, type: 'shortest' }).toEqual(shortest);
    expect(shortest.safetyScore).toBe(96);
  });

  it('넓은 길이 20%를 넘게 돌아가면 점수가 높아도 고르지 않는다', async () => {
    const { service } = setup({
      broadRoute: Promise.resolve(broad(428)), // 25% 김
      shortestRaw: 0,
      broadRaw: 10,
    });
    const res = await service.search(REQ);
    expect(res.sameRoute).toBe(true);
    expect(res.routes[1].distanceM).toBe(342);
  });

  it.each([
    ['night', 'safe'],
    ['day', 'shortest'],
  ] as const)('mode %s → recommended %s', async (mode, recommended) => {
    const { service } = setup();
    const res = await service.search({ ...REQ, mode });
    expect(res.recommended).toBe(recommended);
  });

  it('넓은 길만 못 찾으면(404) 최단경로로 답한다', async () => {
    const { service, rawScores } = setup({
      broadRoute: Promise.reject(
        new ApiException(404, 'ROUTE_NOT_FOUND', '경로를 찾지 못했어요'),
      ),
    });
    const res = await service.search(REQ);
    expect(res.sameRoute).toBe(true);
    expect(rawScores.mock.calls[0][0]).toHaveLength(SEGMENTS);
  });

  it('넓은 길이 한도 초과(503)면 최단경로만 보여 주지 않고 에러', async () => {
    const { service } = setup({
      broadRoute: Promise.reject(
        new ApiException(503, 'QUOTA_EXCEEDED', '오늘은 경로 검색이 많아요'),
      ),
    });
    expect(await errorOf(service.search(REQ))).toEqual({
      status: 503,
      code: 'QUOTA_EXCEEDED',
    });
  });

  it('최단경로가 실패하면 그 에러를 그대로 던진다', async () => {
    const { service, find, rawScores } = setup();
    find.mockImplementation((_o, _d, mode) =>
      mode === 'SHORTEST'
        ? Promise.reject(
            new ApiException(
              404,
              'ORIGIN_UNREACHABLE',
              '출발지 근처에 길이 없어요',
            ),
          )
        : Promise.resolve(broad(380)),
    );
    expect(await errorOf(service.search(REQ))).toEqual({
      status: 404,
      code: 'ORIGIN_UNREACHABLE',
    });
    expect(rawScores).not.toHaveBeenCalled();
  });

  it.each([
    ['출발지가 서울역', { lat: 37.5547, lng: 126.9707 }, WOOSONG],
    ['도착지가 서울역', DAEJEON_STATION, { lat: 37.5547, lng: 126.9707 }],
  ])(
    '%s이면 카카오를 부르지 않고 400 OUT_OF_AREA',
    async (_, origin, destination) => {
      const { service, find } = setup();
      expect(
        await errorOf(service.search({ origin, destination, mode: 'night' })),
      ).toEqual({ status: 400, code: 'OUT_OF_AREA' });
      expect(find).not.toHaveBeenCalled();
    },
  );
});
