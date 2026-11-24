import type { LatLng } from '../../../../shared/types.js';
import {
  AUGMENT_OVERLAP_MIN,
  AUGMENT_SCORE_BELOW,
  MAX_RETRACE_M,
  pickWaypoints,
  retraceM,
  routeOverlap,
  shouldAugment,
  WAYPOINT_MAX,
  WAYPOINT_MIN_DENSITY,
  WAYPOINT_MIN_GAP_M,
} from './waypoints.js';

/** 대전역 근처에서 동쪽으로 `meters`m 가는 직선 경로 (10m 간격) */
function eastward(meters: number, lat = 36.3323): LatLng[] {
  const lng0 = 127.4346;
  const perM = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: meters / 10 + 1 }, (_, i) => ({
    lat,
    lng: lng0 + i * 10 * perM,
  }));
}

describe('shouldAugment (승민 안 — 임시값)', () => {
  it('겹침 98% 이상이거나 높은 점수가 70점 미만이면 보강한다', () => {
    expect(AUGMENT_OVERLAP_MIN).toBe(0.98);
    expect(AUGMENT_SCORE_BELOW).toBe(70);
    expect(shouldAugment(0.98, 90)).toBe(true);
    expect(shouldAugment(0.5, 69)).toBe(true);
    expect(shouldAugment(0.97, 70)).toBe(false);
  });
});

describe('routeOverlap', () => {
  const path = eastward(500);

  it('같은 길이면 1, 20m 안으로 나란하면 같은 길로 본다', () => {
    expect(routeOverlap(path, path)).toBe(1);
    const beside = path.map((p) => ({ ...p, lat: p.lat + 15 / 110574 }));
    expect(routeOverlap(path, beside)).toBe(1);
  });

  it('100m 넘게 떨어진 길이면 0', () => {
    const apart = path.map((p) => ({ ...p, lat: p.lat + 0.001 }));
    expect(routeOverlap(path, apart)).toBe(0);
  });

  it('한쪽이 다른 쪽의 일부면 작은 쪽 기준으로 낮게 잡는다 (양쪽 중 작은 값)', () => {
    const half = eastward(250);
    // half는 path 위에 다 있지만 path는 절반(+ 허용 거리 20m)만 half 위에 있다 → 작은 쪽 약 0.54
    const overlap = routeOverlap(path, half);
    expect(overlap).toBeGreaterThan(0.5);
    expect(overlap).toBeLessThan(0.6);
    expect(routeOverlap(half, path)).toBe(overlap);
  });
});

describe('retraceM', () => {
  it('곧게 가는 길은 0', () => {
    expect(retraceM(eastward(500))).toBe(0);
  });

  it('200m 들어갔다 같은 길로 나오면 되돌아감이 있다 → 경유지 후보에서 뺀다', () => {
    const inAndOut = [...eastward(200), ...eastward(200).reverse()];
    expect(retraceM(inAndOut)).toBeGreaterThanOrEqual(150);
    expect(retraceM(inAndOut)).toBeGreaterThanOrEqual(MAX_RETRACE_M);
  });
});

describe('pickWaypoints', () => {
  const base = eastward(1000);
  const origin = base[0];
  const destination = base[base.length - 1];
  /** 기준 경로 x m 지점에서 북쪽으로 50m 떨어진 후보 */
  const at = (x: number, density: number) => ({
    ...base[x / 10],
    lat: base[x / 10].lat + 50 / 110574,
    density,
  });

  it('밀집도 순으로 최대 3개, 서로 300m 이상, 고른 뒤에는 경로를 따라 출발에 가까운 순', () => {
    expect([WAYPOINT_MAX, WAYPOINT_MIN_GAP_M, WAYPOINT_MIN_DENSITY]).toEqual([
      3, 300, 5,
    ]);
    const picked = pickWaypoints(
      [at(850, 9), at(150, 8), at(250, 7), at(500, 6), at(700, 5.5)],
      base,
      origin,
      destination,
      1000,
    );
    // 250(150에서 100m)은 건너뛰고, 3개를 채우면 멈춘다(700은 안 봄)
    expect(picked.map((p) => p.lng)).toEqual(
      [150, 500, 850].map((x) => at(x, 0).lng),
    );
  });

  it('밀집도가 5 미만이면 거기서 멈춘다', () => {
    expect(
      pickWaypoints([at(500, 4.9)], base, origin, destination, 1000),
    ).toEqual([]);
  });

  it('출발 → 경유지 → 도착 직선 합이 최단의 1.3배를 넘는 지점은 건너뛴다', () => {
    const far = { ...base[50], lat: base[50].lat + 0.004, density: 9 }; // 북쪽 약 440m
    const picked = pickWaypoints(
      [far, at(500, 6)],
      base,
      origin,
      destination,
      1000,
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].lat).toBeCloseTo(at(500, 6).lat, 6);
  });
});
