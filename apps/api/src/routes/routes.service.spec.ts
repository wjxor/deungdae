import {
  DAEJEON_STATION,
  WALK_OK,
  WOOSONG,
} from '../../test/fixtures/kakao-walk.js';
import { ApiException } from '../common/api-exception.js';
import { toWalkRoute } from '../walk/kakao-walk.convert.js';
import type { WalkRouteService } from '../walk/walk-route.service.js';
import { RoutesService } from './routes.service.js';
import { toSafetyLevel } from './safety.js';

/** 도보 경로를 실제 응답 조각으로 답하는 RoutesService */
function setup() {
  const find = vi.fn(() => Promise.resolve(toWalkRoute(WALK_OK)));
  const service = new RoutesService({ find } as unknown as WalkRouteService);
  return { service, find };
}

describe('RoutesService', () => {
  it('최단경로는 카카오 SHORTEST, 안심경로는 아직 최단경로와 같아 sameRoute: true', async () => {
    const { service, find } = setup();
    const res = await service.search({
      origin: DAEJEON_STATION,
      destination: WOOSONG,
      mode: 'night',
    });

    expect(find).toHaveBeenCalledWith(DAEJEON_STATION, WOOSONG, 'SHORTEST');
    expect(res.sameRoute).toBe(true);
    expect(res.routes.map((r) => r.type)).toEqual(['shortest', 'safe']);
    const [shortest, safe] = res.routes;
    expect({ ...safe, type: 'shortest' }).toEqual(shortest);
    expect(shortest).toMatchObject({ distanceM: 342, durationS: 335 });
    expect(shortest.path).toHaveLength(17);
    expect(shortest.segments.length).toBeGreaterThan(0);
  });

  it.each([
    ['night', 'safe'],
    ['day', 'shortest'],
  ] as const)('mode %s → recommended %s', async (mode, recommended) => {
    const { service } = setup();
    const res = await service.search({
      origin: DAEJEON_STATION,
      destination: WOOSONG,
      mode,
    });
    expect(res.recommended).toBe(recommended);
  });

  it('점수는 아직 매기지 않아 모든 구간이 0점', async () => {
    const { service } = setup();
    const res = await service.search({
      origin: DAEJEON_STATION,
      destination: WOOSONG,
      mode: 'night',
    });
    expect(res.routes[0].safetyScore).toBe(0);
    for (const s of res.routes[0].segments) {
      expect(s).toMatchObject({ safetyScore: 0, level: 'danger' });
    }
  });

  it.each([
    ['출발지가 서울역', { lat: 37.5547, lng: 126.9707 }, WOOSONG],
    ['도착지가 서울역', DAEJEON_STATION, { lat: 37.5547, lng: 126.9707 }],
  ])(
    '%s이면 카카오를 부르지 않고 400 OUT_OF_AREA',
    async (_, origin, destination) => {
      const { service, find } = setup();
      const e = await service
        .search({ origin, destination, mode: 'night' })
        .catch((err: unknown) => err);
      expect((e as ApiException).getStatus()).toBe(400);
      expect((e as ApiException).getResponse()).toMatchObject({
        error: { code: 'OUT_OF_AREA' },
      });
      expect(find).not.toHaveBeenCalled();
    },
  );
});

describe('toSafetyLevel', () => {
  it.each([
    [100, 'safe'],
    [70, 'safe'],
    [69, 'caution'],
    [40, 'caution'],
    [39, 'danger'],
    [0, 'danger'],
  ] as const)('%i점 → %s', (score, level) => {
    expect(toSafetyLevel(score)).toBe(level);
  });
});
