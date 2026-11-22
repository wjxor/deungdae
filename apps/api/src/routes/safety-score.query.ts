import type {
  FacilityCounts,
  LatLng,
  ScoreFacilityType,
} from '../../../../shared/types.js';
import { Prisma } from '../generated/prisma/client.js';
import { CAPPED_LIGHT_TYPES, LIGHT_CAP_PER_SEGMENT } from './safety.js';

/** 구간마다 이 반경 안의 시설을 센다 (REQUIREMENTS 안전점수 규칙) */
export const FACILITY_RADIUS_M = 30;

/** 5종 모두 0인 시설 개수. `ScoreFacilityType`과 종류가 어긋나면(빠지거나 남으면) `satisfies`가 컴파일 에러로 알려 준다 */
const ZERO_FACILITY_COUNTS = {
  street_light: 0,
  security_light: 0,
  cctv: 0,
  emergency_bell: 0,
  police: 0,
} satisfies FacilityCounts;

/** 안전점수에 쓰는 시설 5종 — ERD `facility_types.code`. 경로별 개수 응답의 키 순서이기도 하다 */
export const SCORE_FACILITY_TYPES = Object.keys(
  ZERO_FACILITY_COUNTS,
) as readonly ScoreFacilityType[];

/** 5종 모두 0인 새 개수 객체 */
export function emptyFacilityCounts(): FacilityCounts {
  return { ...ZERO_FACILITY_COUNTS };
}

/** `segmentScoreQuery` 결과 한 행. 시설이 하나도 없는 구간은 행이 없다 */
export type SegmentScoreRow = { i: number; raw: number };

/** `routeFacilityQuery` 결과 한 행. `type`은 DB 값 그대로라 5종 밖의 값이 올 수도 있다. 없는 종류는 행이 없다 */
export type RouteFacilityRow = { i: number; type: string; n: number };

/**
 * 구간(선)마다 반경 30m 안 시설의 가중치 합(원점수)을 구하는 SQL. 가중치는 `facility_types.weight`라
 * 배포 없이 DB에서 바꿀 수 있다 (ERD). `i`는 `paths`의 순서다.
 * 종류별로 같은 좌표는 한 곳으로 센다 — 같은 자리에 CCTV가 여러 대여도 한 번 (2026-11-04 팀 확정, ROADMAP "결정된 것").
 * 좌표는 반올림하지 않고 `ST_AsBinary`가 같을 때만 같은 곳이다 (`/facilities` 마커 묶기와 같은 규칙).
 * 같은 좌표가 있는 것은 지금 CCTV(2,984 → 2,382곳)·안심벨(575 → 435곳)뿐이다. 규칙은 모든 종류에 걸려서,
 * 가로등·보안등을 다시 적재해 같은 좌표가 생기면 그것도 한 곳으로 센다 (2026-11-04 승민 확인, PR #54)
 * 가로등·보안등은 합쳐 구간당 `LIGHT_CAP_PER_SEGMENT`개까지만 더한다 (2026-11-19, PR #84). 둘의 가중치가 다르면 큰 쪽부터 센다.
 * 가중치는 가로등·보안등을 1로 맞춘 배수라 소수다 (2026-11-21, PR #86)
 * 분석 스크립트(scripts/safety-score-experiment.mjs)도 이 함수로 같은 SQL을 돌린다
 */
export function segmentScoreQuery(paths: readonly LatLng[][]): Prisma.Sql {
  const ids = paths.map((_, i) => i);
  const lightTypes = [...CAPPED_LIGHT_TYPES];
  return Prisma.sql`
    SELECT w.i, sum(w.weight)::float8 AS raw
    FROM (
      SELECT spot.i, ft.weight, spot.type = ANY(${lightTypes}::text[]) AS light,
        row_number() OVER (PARTITION BY spot.i, spot.type = ANY(${lightTypes}::text[]) ORDER BY ft.weight DESC) AS rank
      FROM (${spotsNear(ids, paths)}) AS spot
      JOIN facility_types ft ON ft.code = spot.type
    ) AS w
    WHERE NOT w.light OR w.rank <= ${LIGHT_CAP_PER_SEGMENT}
    GROUP BY w.i`;
}

/**
 * 경로마다 반경 30m 안 시설을 종류별로 세는 SQL — 경로 화면 펼침의 "경로 주변 안심시설"용 (FR-007).
 * `segmentsByRoute[k]`는 경로 k의 구간 선들이다. 구간을 이으면 경로 선이라 결과는 경로 선 전체에서 센 것과 같고,
 * 경로 번호로 묶어 구간 둘에 걸친 시설도 한 번만 센다. 점수 쿼리와 같은 지점 규칙이라 같은 좌표는 한 곳이다.
 * 경로 선 하나를 통째로 넘기면 인덱스가 경로 전체를 감싸는 사각형을 훑어 14.7km 경로에서 8초 걸려서 구간으로 넘긴다
 * (2026-11-17 로컬 측정, 구간이면 점수 쿼리처럼 50m 단위로 찾는다). `i`는 경로 순서다
 */
export function routeFacilityQuery(
  segmentsByRoute: readonly LatLng[][][],
): Prisma.Sql {
  const ids = segmentsByRoute.flatMap((segments, k) => segments.map(() => k));
  return Prisma.sql`
    SELECT spot.i, spot.type, count(*)::int AS n
    FROM (${spotsNear(ids, segmentsByRoute.flat())}) AS spot
    GROUP BY spot.i, spot.type`;
}

/** 선마다 반경 30m 안의 지점(종류·좌표가 같으면 `ids`별로 한 행) — 점수·개수 쿼리가 같이 쓴다. `ids[j]`가 `paths[j]`의 번호 */
function spotsNear(
  ids: readonly number[],
  paths: readonly LatLng[][],
): Prisma.Sql {
  const lines = paths.map(toLineWkt);
  return Prisma.sql`
      SELECT DISTINCT s.i, f.type, ST_AsBinary(f.location)
      FROM unnest(${ids}::int[], ${lines}::text[]) AS s(i, wkt)
      JOIN facilities f
        ON ST_DWithin(f.location, ST_GeogFromText(s.wkt), ${FACILITY_RADIUS_M}::float8)`;
}

/** 좌표 목록 → `SRID=4326;LINESTRING(경도 위도, …)` (WKT는 경도가 먼저). 분석 스크립트가 종류별 개수를 셀 때도 쓴다 */
export function toLineWkt(path: readonly LatLng[]): string {
  return `SRID=4326;LINESTRING(${path.map((p) => `${p.lng} ${p.lat}`).join(', ')})`;
}
