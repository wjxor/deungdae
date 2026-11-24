import type { LatLng } from '../../../../shared/types.js';
import { Prisma } from '../generated/prisma/client.js';
import { FACILITY_RADIUS_M } from './safety-score.query.js';
import {
  CAPPED_LIGHT_TYPES,
  LIGHT_CAP_PER_SEGMENT,
  SCORE_CAP_RAW,
} from './safety.js';
import {
  WAYPOINT_CORRIDOR_M,
  WAYPOINT_END_MARGIN_M,
  WAYPOINT_OFF_ROUTE_M,
} from './waypoints.js';

/** 밀집도가 높은 후보를 이만큼만 받는다 (`pickWaypoints`가 앞에서부터 3개까지 고른다) */
const CANDIDATE_LIMIT = 300;

export type WaypointQueryInput = {
  /** 경유지 후보를 찾을 경로들 — 최단·큰길 */
  corridorPaths: readonly LatLng[][];
  /** 경유지를 넣을 기준 경로. 이 경로 위의 지점은 길을 바꾸지 못해서 뺀다 */
  basePath: readonly LatLng[];
  origin: LatLng;
  destination: LatLng;
};

/**
 * A 보강 경유지 후보 지점 SQL (FR-006, 경유지 실험 `pickVias`와 같은 조건).
 * 최단·큰길에서 100m 안의 시설 중, 기준 경로 위(60m 안)가 아니고 출발·도착에서 150m 넘게 떨어진 것을
 * 밀집도가 높은 순(같으면 기준 경로에 가까운 순)으로 돌려준다.
 * 밀집도는 서버 점수와 같은 식이다 — 지점 반경 30m 안 시설의 가중치 합, 종류별로 같은 좌표는 한 곳,
 * 가로등·보안등은 합쳐 `LIGHT_CAP_PER_SEGMENT`개까지(승민 #90 의견 — 고르는 기준이 점수와 다르면 비교가 어긋나서, 2026-11-24 PR #101 확정), 원점수 상한까지.
 * 상한 없이 세는 변형은 고르는 길이 200쌍 중 1쌍만 달라 쓰지 않았다 (2026-11-24, docs/waypoint-experiment.md)
 */
export function waypointCandidateQuery(input: WaypointQueryInput): Prisma.Sql {
  const corridor = multiLineWkt(input.corridorPaths);
  const base = multiLineWkt([input.basePath]);
  const lightTypes = [...CAPPED_LIGHT_TYPES];
  return Prisma.sql`
    SELECT ST_Y(f.location::geometry)::float8 AS lat, ST_X(f.location::geometry)::float8 AS lng,
      LEAST((
        SELECT coalesce(sum(r.weight), 0)
        FROM (
          SELECT t.weight, t.light, row_number() OVER (PARTITION BY t.light ORDER BY t.weight DESC) AS rank
          FROM (
            SELECT DISTINCT ON (f2.type, ST_AsBinary(f2.location)) ft2.weight, f2.type = ANY(${lightTypes}::text[]) AS light
            FROM facilities f2
            JOIN facility_types ft2 ON ft2.code = f2.type
            WHERE ST_DWithin(f2.location, f.location, ${FACILITY_RADIUS_M}::float8)
          ) AS t
        ) AS r
        WHERE NOT r.light OR r.rank <= ${LIGHT_CAP_PER_SEGMENT}::int
      ), ${SCORE_CAP_RAW}::float8)::float8 AS density
    FROM facilities f
    WHERE ST_DWithin(f.location, ST_GeogFromText(${corridor}), ${WAYPOINT_CORRIDOR_M}::float8)
      AND NOT ST_DWithin(f.location, ST_GeogFromText(${pointWkt(input.origin)}), ${WAYPOINT_END_MARGIN_M}::float8)
      AND NOT ST_DWithin(f.location, ST_GeogFromText(${pointWkt(input.destination)}), ${WAYPOINT_END_MARGIN_M}::float8)
      AND NOT ST_DWithin(f.location, ST_GeogFromText(${base}), ${WAYPOINT_OFF_ROUTE_M}::float8)
    ORDER BY density DESC, ST_Distance(f.location, ST_GeogFromText(${base})) ASC
    LIMIT ${CANDIDATE_LIMIT}::int`;
}

/** 경로들 → `SRID=4326;MULTILINESTRING((경도 위도, …), …)` */
function multiLineWkt(paths: readonly (readonly LatLng[])[]): string {
  return `SRID=4326;MULTILINESTRING(${paths.map((p) => `(${p.map((q) => `${q.lng} ${q.lat}`).join(', ')})`).join(', ')})`;
}

/** 좌표 → `SRID=4326;POINT(경도 위도)` */
function pointWkt(p: LatLng): string {
  return `SRID=4326;POINT(${p.lng} ${p.lat})`;
}
