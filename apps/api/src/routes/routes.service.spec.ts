import type { FacilityCounts, LatLng } from '../../../../shared/types.js';
import {
  DAEJEON_STATION,
  WALK_OK,
  WOOSONG,
} from '../../test/fixtures/kakao-walk.js';
import { Logger } from '@nestjs/common';
import { ApiException, externalApiError } from '../common/api-exception.js';
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

/** k번째 경로에 CCTV k + 1곳, 나머지는 0인 시설 개수 (경로 순서를 확인하려고) */
const countsOf = (k: number): FacilityCounts => ({
  street_light: 0,
  security_light: 0,
  cctv: k + 1,
  emergency_bell: 0,
  police: 0,
});

/** 넓은 길 우선 후보. 모양은 최단과 같게 두고 거리만 바꾼다 (점수는 가짜 원점수로 정함) */
const broad = (distanceM: number): WalkRoute => ({ ...SHORTEST, distanceM });

/**
 * 카카오(route_mode별)와 원점수를 가짜로 둔 RoutesService.
 * 원점수는 앞쪽 구간(최단경로)에 `shortestRaw`, 뒤쪽 구간(넓은 길)에 `broadRaw`를 준다. 시설 개수는 `countsOf(경로 순서)`
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
  const facilityCounts = vi.fn(
    (routes: LatLng[][][]): Promise<FacilityCounts[]> =>
      Promise.resolve(routes.map((_, k) => countsOf(k))),
  );
  // 이 묶음의 큰길은 최단과 모양이 같아 A 보강 조건(겹침)에 걸린다. 경유지 후보는 없다고 답해 B안만 본다
  const waypointCandidates = vi.fn(() => Promise.resolve([]));
  const service = new RoutesService(
    { find } as unknown as WalkRouteService,
    {
      rawScores,
      facilityCounts,
      waypointCandidates,
    } as unknown as SafetyScoreService,
  );
  return { service, find, rawScores, facilityCounts };
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

  it('넓은 길이 5점 이상 높고 30% 안으로 돌아가면 안심경로', async () => {
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

  it('넓은 길이 30%를 넘게 돌아가면 점수가 높아도 고르지 않는다', async () => {
    const { service } = setup({
      broadRoute: Promise.resolve(broad(445)), // 30.1% 김
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

  it('경로마다 시설 개수를 담는다 — 점수와 같은 구간 조각을 경로별로 넘겨 한 번에 센다', async () => {
    // 두 후보를 구분하려고 넓은 길은 모양을 뒤집는다
    const broadPath = [...SHORTEST.path].reverse();
    const { service, facilityCounts } = setup({
      broadRoute: Promise.resolve({ ...broad(380), path: broadPath }),
      shortestRaw: 1,
      broadRaw: 5,
    });
    const res = await service.search(REQ);

    expect(res.sameRoute).toBe(false);
    const [shortest, safe] = res.routes;
    expect(shortest.facilityCounts).toEqual(countsOf(0));
    expect(safe.facilityCounts).toEqual(countsOf(1));
    expect(facilityCounts).toHaveBeenCalledOnce();
    expect(facilityCounts).toHaveBeenCalledWith([
      splitPath(SHORTEST.path).map((p) => p.path),
      splitPath(broadPath).map((p) => p.path),
    ]);
  });

  it('같은 경로면 두 경로의 시설 개수가 같다', async () => {
    const { service } = setup({ shortestRaw: 9, broadRaw: 10 });
    const res = await service.search(REQ);

    expect(res.sameRoute).toBe(true);
    expect(res.routes[1].facilityCounts).toEqual(res.routes[0].facilityCounts);
    expect(res.routes[0].facilityCounts).toEqual(countsOf(0));
  });

  it('넓은 길 우선이 4xx면 최단 하나만 센다', async () => {
    const { service, facilityCounts } = setup({
      broadRoute: Promise.reject(
        new ApiException(404, 'ROUTE_NOT_FOUND', '경로를 찾지 못했어요'),
      ),
    });
    const res = await service.search(REQ);

    expect(facilityCounts).toHaveBeenCalledWith([
      splitPath(SHORTEST.path).map((p) => p.path),
    ]);
    expect(res.routes[0].facilityCounts).toEqual(countsOf(0));
    expect(res.routes[1].facilityCounts).toEqual(countsOf(0));
  });

  it('시설 개수 조회가 실패하면 점수가 있어도 502', async () => {
    const { service, facilityCounts } = setup();
    facilityCounts.mockRejectedValue(
      externalApiError('안전점수를 잠시 계산하지 못했어요'),
    );
    expect(await errorOf(service.search(REQ))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
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

describe('RoutesService A 보강 (FR-006)', () => {
  const ORIGIN = SHORTEST.path[0];
  const DESTINATION = SHORTEST.path[SHORTEST.path.length - 1];
  const REQ_NEAR = {
    origin: ORIGIN,
    destination: DESTINATION,
    mode: 'night',
  } as const;
  /** 경로 가운데 꼭짓점 — 출발 → 여기 → 도착 직선 합이 최단 거리보다 짧아 우회 한도에 걸리지 않는다 */
  const MID = SHORTEST.path[Math.floor(SHORTEST.path.length / 2)];
  /** 큰길을 최단에서 북쪽으로 약 110m 옮긴 길 — 겹침 0 */
  const apart: WalkRoute = {
    ...SHORTEST,
    distanceM: 380,
    path: SHORTEST.path.map((p) => ({ lat: p.lat + 0.001, lng: p.lng })),
  };
  /** 경유지를 넣은 경로 — 모양은 최단과 같고 58m 더 돈다 (17%) */
  const VIA: WalkRoute = { ...SHORTEST, distanceM: 400 };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 카카오는 경유지가 있으면 `viaRoute`, 없으면 최단·큰길. 원점수는 첫 호출(최단·큰길)에 `baseRaw`, 그 뒤(경유지 경로)에 `viaRaw`
   */
  function setupAugment({
    broadRoute = SHORTEST as WalkRoute,
    baseRaw = 1,
    viaRaw = 5,
    viaRoute = (): Promise<WalkRoute> => Promise.resolve(VIA),
    candidates = (): Promise<unknown> =>
      Promise.resolve([{ ...MID, density: 6 }]),
  } = {}) {
    const find = vi.fn(
      (
        _o: LatLng,
        _d: LatLng,
        mode: KakaoRouteMode,
        waypoints: LatLng[] = [],
      ): Promise<WalkRoute> => {
        if (waypoints.length > 0) return viaRoute();
        return Promise.resolve(mode === 'SHORTEST' ? SHORTEST : broadRoute);
      },
    );
    let call = 0;
    const rawScores = vi.fn((paths: LatLng[][]) => {
      const raw = call++ === 0 ? baseRaw : viaRaw;
      return Promise.resolve(paths.map(() => raw));
    });
    const facilityCounts = vi.fn(
      (routes: LatLng[][][]): Promise<FacilityCounts[]> =>
        Promise.resolve(routes.map((_, k) => countsOf(k))),
    );
    const waypointCandidates = vi.fn(candidates);
    const service = new RoutesService(
      { find } as unknown as WalkRouteService,
      {
        rawScores,
        facilityCounts,
        waypointCandidates,
      } as unknown as SafetyScoreService,
    );
    return { service, find, waypointCandidates };
  }

  /** `find`가 받은 (route_mode, 경유지) 목록 */
  const callsOf = (find: ReturnType<typeof vi.fn>) =>
    find.mock.calls.map((c: unknown[]) => [c[2], c[3] ?? []]);

  it('겹침이 낮고 점수도 70점 이상이면 보강하지 않는다', async () => {
    const { service, find, waypointCandidates } = setupAugment({
      broadRoute: apart,
      baseRaw: 5, // 75점
    });
    await service.search(REQ_NEAR);
    expect(waypointCandidates).not.toHaveBeenCalled();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('최단·큰길이 같은 길이면 경유지 경로 2건을 같은 route_mode로 더 부르고, 5점 이상 높으면 안심경로', async () => {
    const { service, find, waypointCandidates } = setupAugment({
      baseRaw: 5, // 75점이어도 겹침 100%라 보강
      viaRaw: 10, // 100점
    });
    const res = await service.search(REQ_NEAR);

    // 기준 경로(최단·큰길)마다 경유지 후보를 고른다
    expect(waypointCandidates).toHaveBeenCalledTimes(2);
    expect(callsOf(find)).toEqual(
      expect.arrayContaining([
        ['SHORTEST', [MID]],
        ['BROAD_FIRST', [MID]],
      ]),
    );
    expect(find).toHaveBeenCalledTimes(4);
    expect(res.sameRoute).toBe(false);
    expect(res.routes[1]).toMatchObject({ distanceM: 400, safetyScore: 100 });
  });

  it('겹치지 않아도 높은 점수가 70점 미만이면 보강한다', async () => {
    const { service, waypointCandidates } = setupAugment({
      broadRoute: apart,
      baseRaw: 1, // 29점
    });
    const res = await service.search(REQ_NEAR);
    expect(waypointCandidates).toHaveBeenCalled();
    expect(res.routes[1].distanceM).toBe(400);
  });

  it('경유지 후보가 없으면 카카오를 더 부르지 않는다', async () => {
    const { service, find } = setupAugment({
      candidates: () => Promise.resolve([{ ...MID, density: 4 }]), // 밀집도 5 미만
    });
    const res = await service.search(REQ_NEAR);
    expect(find).toHaveBeenCalledTimes(2);
    expect(res.sameRoute).toBe(true);
  });

  it('왔던 길을 되돌아가는 경유지 경로는 뺀다', async () => {
    const back = [...SHORTEST.path, ...[...SHORTEST.path].reverse()];
    const { service } = setupAugment({
      viaRoute: () => Promise.resolve({ ...VIA, path: back }),
    });
    const res = await service.search(REQ_NEAR);
    expect(res.sameRoute).toBe(true);
  });

  it('경유지 후보 조회가 실패하면 에러 없이 B안 결과로 답한다', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { service, find } = setupAugment({
      candidates: () => Promise.reject(externalApiError('DB 실패')),
    });
    const res = await service.search(REQ_NEAR);
    expect(res.sameRoute).toBe(true);
    expect(find).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'EXTERNAL_API_ERROR',
    );
  });

  it('경유지 경로가 한도 초과(503)여도 B안 결과로 답한다', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const quota = new ApiException(
      503,
      'QUOTA_EXCEEDED',
      '오늘은 경로 검색이 많아요',
    );
    const { service } = setupAugment({ viaRoute: () => Promise.reject(quota) });
    const res = await service.search(REQ_NEAR);
    expect(res.sameRoute).toBe(true);
    expect(res.routes[1].distanceM).toBe(SHORTEST.distanceM);
  });
});
