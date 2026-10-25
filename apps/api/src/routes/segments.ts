import type { LatLng } from '../../../../shared/types.js';
import { distanceM } from '../common/geo.js';

/** 구간 길이 목표 (REQUIREMENTS 안전점수 규칙: 약 50m 단위) */
export const SEGMENT_TARGET_M = 50;

/** 이보다 가까운 두 위치는 같은 위치로 본다 (m) */
const EPSILON_M = 1e-6;

/** 점수를 매기기 전의 구간 — 모양과 길이만 */
export type PathPiece = { path: LatLng[]; distanceM: number };

/**
 * 경로를 길이가 같은 약 50m 구간으로 나눈다 (API.md 3장 `Segment`).
 * - 구간 수는 `전체 길이 / 50`을 반올림한 값(최소 1)이라 구간 길이는 40~67m다 (경로가 75m보다 짧으면 구간 하나)
 * - 구간 경계는 경로 위의 점을 직선으로 보간해 만들고, 앞 구간의 끝점 = 다음 구간의 첫 점
 * - 첫 구간은 경로의 첫 점에서, 마지막 구간은 경로의 마지막 점에서 끝난다
 */
export function splitPath(
  path: LatLng[],
  targetM = SEGMENT_TARGET_M,
): PathPiece[] {
  if (path.length < 2) return [];

  // 시작점에서 각 점까지 경로를 따라간 거리
  const along = [0];
  for (let i = 1; i < path.length; i++) {
    along.push(along[i - 1] + distanceM(path[i - 1], path[i]));
  }
  const total = along[along.length - 1];
  const count = Math.max(1, Math.round(total / targetM));
  const pieceM = total / count;

  const pieces: PathPiece[] = [];
  let start = path[0];
  let startAt = 0;
  let next = 1; // 아직 어느 구간에도 넣지 않은 점
  for (let k = 1; k <= count; k++) {
    const endAt = k === count ? total : k * pieceM;
    const points = [start];
    while (next < path.length - 1 && along[next] < endAt - EPSILON_M) {
      // 구간 시작점과 겹치는 점(경계가 마침 점 위에 놓인 경우)은 넣지 않는다
      if (along[next] > startAt + EPSILON_M) points.push(path[next]);
      next++;
    }
    const end =
      k === count ? path[path.length - 1] : pointAt(path, along, next, endAt);
    points.push(end);
    pieces.push({ path: points, distanceM: Math.round(endAt - startAt) });
    start = end;
    startAt = endAt;
  }
  return pieces;
}

/** `path[i - 1]`과 `path[i]` 사이에서, 시작점부터 `at`m인 위치 (직선 보간) */
function pointAt(
  path: LatLng[],
  along: number[],
  i: number,
  at: number,
): LatLng {
  const a = path[i - 1];
  const b = path[i];
  const span = along[i] - along[i - 1];
  const t = span > 0 ? Math.min(1, Math.max(0, (at - along[i - 1]) / span)) : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}
