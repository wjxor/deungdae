import type { LatLng } from '../../../../shared/types.js';
import { Prisma } from '../generated/prisma/client.js';

/** 구간마다 이 반경 안의 시설을 센다 (REQUIREMENTS 안전점수 규칙) */
export const FACILITY_RADIUS_M = 30;

/** `segmentScoreQuery` 결과 한 행. 시설이 하나도 없는 구간은 행이 없다 */
export type SegmentScoreRow = { i: number; raw: number };

/**
 * 구간(선)마다 반경 30m 안 시설의 가중치 합(원점수)을 구하는 SQL. 가중치는 `facility_types.weight`라
 * 배포 없이 DB에서 바꿀 수 있다 (ERD). `i`는 `paths`의 순서다.
 * 종류별로 같은 좌표는 한 곳으로 센다 — 같은 자리에 CCTV가 여러 대여도 한 번 (2026-11-04 팀 확정, ROADMAP "결정된 것").
 * 좌표는 반올림하지 않고 `ST_AsBinary`가 같을 때만 같은 곳이다 (`/facilities` 마커 묶기와 같은 규칙).
 * 분석 스크립트(scripts/safety-score-experiment.mjs)도 이 함수로 같은 SQL을 돌린다
 */
export function segmentScoreQuery(paths: readonly LatLng[][]): Prisma.Sql {
  const ids = paths.map((_, i) => i);
  const lines = paths.map(toLineWkt);
  return Prisma.sql`
    SELECT spot.i, sum(ft.weight)::int AS raw
    FROM (
      SELECT DISTINCT s.i, f.type, ST_AsBinary(f.location)
      FROM unnest(${ids}::int[], ${lines}::text[]) AS s(i, wkt)
      JOIN facilities f
        ON ST_DWithin(f.location, ST_GeogFromText(s.wkt), ${FACILITY_RADIUS_M}::float8)
    ) AS spot
    JOIN facility_types ft ON ft.code = spot.type
    GROUP BY spot.i`;
}

/** 좌표 목록 → `SRID=4326;LINESTRING(경도 위도, …)` (WKT는 경도가 먼저) */
function toLineWkt(path: readonly LatLng[]): string {
  return `SRID=4326;LINESTRING(${path.map((p) => `${p.lng} ${p.lat}`).join(', ')})`;
}
