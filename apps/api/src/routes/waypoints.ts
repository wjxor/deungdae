import type { LatLng } from '../../../../shared/types.js';
import { distanceM } from '../common/geo.js';
import { SAFE_MAX_DETOUR } from './safety.js';

// A 보강(경유지 후보 추가, FR-006). 2026-11-23 시연 버전에 승민 안 조건으로 붙이기로 했다 (PR #93, ROADMAP "결정된 것").
// 조건의 기준 숫자(`AUGMENT_*`)와 경유지를 고르는 값(`WAYPOINT_*`)은 모두 임시값이다 — 팀이 정하기 전까지 값을 바꾸지 않는다
// (ROADMAP "팀에서 정해야 할 것" A 보강). 고르는 방법은 경유지 실험(docs/waypoint-experiment.md, scripts/waypoint-experiment.mjs)과 같다

/**
 * 최단·큰길 겹침이 이 이상이면 A 보강을 쓴다 (임시값, 팀 결정 대기). 실험에서 "같은 길"로 센 기준과 같다.
 * 200쌍 중 75쌍이 98% 이상이다 (2026-11-24 상협, 11/23 실험 응답)
 */
export const AUGMENT_OVERLAP_MIN = 0.98;

/**
 * 최단·큰길 중 높은 점수가 이보다 낮으면 A 보강을 쓴다 (임시값, 팀 결정 대기). 안전(초록) 등급 기준 70점과 같게 잡았다.
 * 겹침 98%와 함께 쓰면 200쌍 중 136쌍(68%)에서 경유지 경로를 부르고, 다른 길이 31 → 37쌍이 된다 (2026-11-24 상협)
 */
export const AUGMENT_SCORE_BELOW = 70;

/** 기준 경로(최단·큰길)에서 이 안의 시설을 경유지 후보로 본다 (실험 `--corridor 100`) */
export const WAYPOINT_CORRIDOR_M = 100;
/** 기준 경로 위(이 안)의 지점은 길을 바꾸지 못해서 뺀다 */
export const WAYPOINT_OFF_ROUTE_M = 60;
/** 출발·도착에서 이만큼 떨어진 지점만 쓴다 (끝에서 되돌아오는 경유지 방지) */
export const WAYPOINT_END_MARGIN_M = 150;
/** 밀집도(지점 반경 30m 안 시설 원점수)가 이 미만이면 경유지로 쓰지 않는다 */
export const WAYPOINT_MIN_DENSITY = 5;
/** 경유지 최대 개수 (승민 안 1~3개. 카카오 한도는 5) */
export const WAYPOINT_MAX = 3;
/** 경유지끼리 이만큼 떨어뜨린다 */
export const WAYPOINT_MIN_GAP_M = 300;
/**
 * 경유지 경로가 왔던 길을 되돌아가는 길이가 이 이상이면 후보에서 뺀다 — 10m 간격으로 세니 사실상 0m만 쓴다.
 * 경유지가 골목·막다른 길에 있으면 카카오가 들어갔다 같은 길로 나오는 경로를 만든다 (실험 `--max-retrace 10`)
 */
export const MAX_RETRACE_M = 10;

/** 두 경로가 이 거리 안이면 같은 길로 센다 (docs/route-mode-experiment.md와 같은 기준) */
const OVERLAP_TOLERANCE_M = 20;

/**
 * A 보강을 쓸지 (승민 안): 후보끼리 겹침이 높거나 가장 높은 점수도 기준보다 낮으면.
 * 큰길 후보가 없으면(카카오가 못 찾음) 고를 게 최단 하나라 겹침 1로 본다
 */
export function shouldAugment(overlap: number, bestScore: number): boolean {
  return overlap >= AUGMENT_OVERLAP_MIN || bestScore < AUGMENT_SCORE_BELOW;
}

/** 두 경로의 겹침 0~1 — 양쪽에서 잰 값 중 작은 것 (실험 스크립트와 같은 계산) */
export function routeOverlap(
  a: readonly LatLng[],
  b: readonly LatLng[],
): number {
  return Math.min(coverage(a, b), coverage(b, a));
}

/** a 경로 위 점(5m 간격) 중 b 경로에서 `OVERLAP_TOLERANCE_M` 안인 비율. 좁은 범위라 평면 근사로 잰다 */
function coverage(a: readonly LatLng[], b: readonly LatLng[]): number {
  if (a.length < 2 || b.length < 2) return a.length < 2 ? 1 : 0;
  const kx = 111320 * Math.cos((a[0].lat * Math.PI) / 180); // 경도 1도 ≈ m
  const ky = 110574; // 위도 1도 ≈ m
  const xy = (p: LatLng): [number, number] => [p.lng * kx, p.lat * ky];
  const bs = b.map(xy);
  const near = ([px, py]: [number, number]): boolean => {
    for (let i = 0; i + 1 < bs.length; i++) {
      const [x1, y1] = bs[i];
      const [x2, y2] = bs[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      const t = len2
        ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
        : 0;
      if (
        Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <=
        OVERLAP_TOLERANCE_M
      )
        return true;
    }
    return false;
  };
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 1 < a.length; i++) {
    const [x1, y1] = xy(a[i]);
    const [x2, y2] = xy(a[i + 1]);
    const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 5));
    for (let k = 0; k < steps; k++) {
      total++;
      if (near([x1 + ((x2 - x1) * k) / steps, y1 + ((y2 - y1) * k) / steps]))
        hit++;
    }
  }
  return total ? hit / total : 1;
}

/**
 * 경로가 왔던 길을 되돌아가는 길이(m)의 근사 (실험 스크립트와 같은 계산).
 * 10m 간격으로 찍은 점 중, 30m 넘게 앞서 지나간 자리의 12m 안으로 다시 온 점의 수 × 10
 */
export function retraceM(path: readonly LatLng[]): number {
  const pts: { p: LatLng; d: number }[] = [];
  let acc = 0;
  let next = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = distanceM(path[i - 1], path[i]);
    while (seg > 0 && next <= acc + seg) {
      const t = (next - acc) / seg;
      pts.push({
        p: {
          lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
          lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
        },
        d: next,
      });
      next += 10;
    }
    acc += seg;
  }
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pts[i].d - pts[j].d > 30 && distanceM(pts[i].p, pts[j].p) <= 12) {
        n++;
        break;
      }
    }
  }
  return n * 10;
}

/** 경유지 후보 지점 — `waypointCandidateQuery` 한 행. 밀집도가 높고 기준 경로에 가까운 순이다 */
export type WaypointCandidate = LatLng & { density: number };

/**
 * 후보 지점에서 경유지를 고른다 (승민 안 1~3개). 밀집도 순으로 보며 `WAYPOINT_MAX`개까지,
 * 밀집도가 `WAYPOINT_MIN_DENSITY` 미만이면 멈추고, 이미 고른 지점과 `WAYPOINT_MIN_GAP_M` 안이면 건너뛴다.
 * 출발 → 경유지들 → 도착 직선 합이 최단 거리의 (1 + 우회 한도)배를 넘으면 그 지점도 건너뛴다 —
 * 직선은 실제 길보다 짧아서 넘으면 우회 한도도 반드시 넘는다(카카오 호출 아끼기).
 * 고른 지점은 기준 경로를 따라 출발에 가까운 순으로 돌려준다 (카카오가 그 순서로 지난다)
 */
export function pickWaypoints(
  candidates: readonly WaypointCandidate[],
  basePath: readonly LatLng[],
  origin: LatLng,
  destination: LatLng,
  shortestDistanceM: number,
): LatLng[] {
  const maxStraightM = shortestDistanceM * (1 + SAFE_MAX_DETOUR);
  const chosen: { p: LatLng; along: number }[] = [];
  for (const c of candidates) {
    if (chosen.length >= WAYPOINT_MAX || c.density < WAYPOINT_MIN_DENSITY)
      break;
    const p = { lat: c.lat, lng: c.lng };
    if (chosen.some((x) => distanceM(x.p, p) < WAYPOINT_MIN_GAP_M)) continue;
    const next = [...chosen, { p, along: alongRoute(basePath, p) }].sort(
      (x, y) => x.along - y.along,
    );
    if (
      straightLength(
        origin,
        next.map((x) => x.p),
        destination,
      ) > maxStraightM
    )
      continue;
    chosen.splice(0, chosen.length, ...next);
  }
  return chosen.map((x) => x.p);
}

/** 기준 경로를 따라 간 거리(m): 점에서 가장 가까운 경로 꼭짓점까지의 누적 거리 */
function alongRoute(path: readonly LatLng[], p: LatLng): number {
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) acc += distanceM(path[i - 1], path[i]);
    const d = distanceM(path[i], p);
    if (d < best) {
      best = d;
      at = acc;
    }
  }
  return at;
}

/** 출발 → 경유지들 → 도착 직선 거리 합 (m) */
function straightLength(
  origin: LatLng,
  vias: readonly LatLng[],
  destination: LatLng,
): number {
  let total = 0;
  let prev = origin;
  for (const v of vias) {
    total += distanceM(prev, v);
    prev = v;
  }
  return total + distanceM(prev, destination);
}
