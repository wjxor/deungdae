import {
  FACILITY_RADIUS_M,
  REPORT_RADIUS_M,
  reportedSegmentQuery,
  routeFacilityQuery,
  SCORE_FACILITY_TYPES,
  segmentScoreQuery,
} from './safety-score.query.js';
import { CAPPED_LIGHT_TYPES, LIGHT_CAP_PER_SEGMENT } from './safety.js';

describe('segmentScoreQuery', () => {
  it('구간을 경도·위도 순 WKT 선으로 넘기고, 반경 30m 안 시설의 가중치를 더한다', () => {
    const q = segmentScoreQuery([
      [
        { lat: 36.3323, lng: 127.4346 },
        { lat: 36.3325, lng: 127.4349 },
      ],
      [
        { lat: 36.3325, lng: 127.4349 },
        { lat: 36.3327, lng: 127.4352 },
        { lat: 36.333, lng: 127.4355 },
      ],
    ]);

    expect(FACILITY_RADIUS_M).toBe(30);
    expect(q.values).toEqual([
      ['street_light', 'security_light'],
      ['street_light', 'security_light'],
      [0, 1],
      [
        'SRID=4326;LINESTRING(127.4346 36.3323, 127.4349 36.3325)',
        'SRID=4326;LINESTRING(127.4349 36.3325, 127.4352 36.3327, 127.4355 36.333)',
      ],
      30,
      5,
    ]);
    expect(q.text).toContain(
      'ST_DWithin(f.location, ST_GeogFromText(s.wkt), $5::float8)',
    );
    // 가중치는 소수(가로등·보안등을 1로 맞춘 배수, PR #86)라 정수로 자르지 않는다
    expect(q.text).toContain('sum(w.weight)::float8 AS raw');
    expect(q.text).toContain('JOIN facility_types ft ON ft.code = spot.type');
  });

  it('가로등·보안등은 합쳐 구간당 5개까지만 더한다 (ROADMAP "결정된 것" 시설 가중치·상한)', () => {
    const q = segmentScoreQuery([
      [
        { lat: 36.3323, lng: 127.4346 },
        { lat: 36.3325, lng: 127.4349 },
      ],
    ]);

    expect(LIGHT_CAP_PER_SEGMENT).toBe(5);
    expect(CAPPED_LIGHT_TYPES).toEqual(['street_light', 'security_light']);
    // 구간마다 가로등·보안등 묶음과 나머지를 나눠 순위를 매기고, 가로등·보안등은 순위 5까지만 남긴다
    expect(q.text).toContain(
      'PARTITION BY spot.i, spot.type = ANY($2::text[]) ORDER BY ft.weight DESC',
    );
    expect(q.text).toContain('WHERE NOT w.light OR w.rank <= $6');
    expect(q.text).toContain('GROUP BY w.i');
  });

  it('종류별로 같은 좌표는 한 곳으로 센다 (지점, ROADMAP "결정된 것" 안전점수)', () => {
    const q = segmentScoreQuery([
      [
        { lat: 36.3323, lng: 127.4346 },
        { lat: 36.3325, lng: 127.4349 },
      ],
    ]);

    // 좌표는 ST_AsBinary로 비교한다. 실험 스크립트의 spots와 같은 방식이고, 반올림하지 않은 완전히 같은 값만 같은 곳이다
    expect(q.text).toContain(
      'SELECT DISTINCT s.i, f.type, ST_AsBinary(f.location)',
    );
  });
});

describe('reportedSegmentQuery', () => {
  const q = reportedSegmentQuery([
    [
      { lat: 36.3323, lng: 127.4346 },
      { lat: 36.3325, lng: 127.4349 },
    ],
    [
      { lat: 36.3325, lng: 127.4349 },
      { lat: 36.3327, lng: 127.4352 },
    ],
  ]);

  it('구간 선마다 반경 30m 안, 최근 30일 제보를 본다 (FR-010, PR #93 1-4)', () => {
    expect(REPORT_RADIUS_M).toBe(30);
    expect(q.values).toEqual([
      [0, 1],
      [
        'SRID=4326;LINESTRING(127.4346 36.3323, 127.4349 36.3325)',
        'SRID=4326;LINESTRING(127.4349 36.3325, 127.4352 36.3327)',
      ],
      30,
      30,
      3,
    ]);
    expect(q.text).toContain(
      'ST_DWithin(r.location, ST_GeogFromText(s.wkt), $3::float8)',
    );
    // 30일은 DB 시각 기준
    expect(q.text).toContain(
      'r.created_at > now() - make_interval(days => $4::int)',
    );
  });

  it('사람 수는 익명 제보자 키로 센다 — 같은 회원은 한 명, 탈퇴해도 그대로', () => {
    // user_id로 세면 탈퇴한 회원(null)이 빠지거나 한데 묶여서, 탈퇴해도 남는 reporter_key로 센다 (2026-11-24 상협)
    expect(q.text).toContain(
      'HAVING count(DISTINCT r.reporter_key) >= $5::int',
    );
    expect(q.text).not.toContain('user_id');
    expect(q.text).toContain('GROUP BY s.i');
  });
});

describe('routeFacilityQuery', () => {
  it('경로마다 구간 선들에서 반경 30m 안 지점을 종류별로 센다 — 구간마다 경로 번호를 붙인다', () => {
    // 경로 0은 구간 2개, 경로 1은 구간 1개
    const q = routeFacilityQuery([
      [
        [
          { lat: 36.3323, lng: 127.4346 },
          { lat: 36.3325, lng: 127.4349 },
        ],
        [
          { lat: 36.3325, lng: 127.4349 },
          { lat: 36.3327, lng: 127.4352 },
        ],
      ],
      [
        [
          { lat: 36.3325, lng: 127.4349 },
          { lat: 36.333, lng: 127.4355 },
        ],
      ],
    ]);

    expect(q.values).toEqual([
      [0, 0, 1],
      [
        'SRID=4326;LINESTRING(127.4346 36.3323, 127.4349 36.3325)',
        'SRID=4326;LINESTRING(127.4349 36.3325, 127.4352 36.3327)',
        'SRID=4326;LINESTRING(127.4349 36.3325, 127.4355 36.333)',
      ],
      30,
    ]);
    // 점수 쿼리와 같은 지점 규칙(종류별로 같은 좌표는 한 곳)이고, 경로 번호로 묶어 구간 둘에 걸친 시설도 한 번만 센다
    expect(q.text).toContain(
      'SELECT DISTINCT s.i, f.type, ST_AsBinary(f.location)',
    );
    expect(q.text).toContain('count(*)::int AS n');
    expect(q.text).toContain('GROUP BY spot.i, spot.type');
  });

  it('SCORE_FACILITY_TYPES는 ERD facility_types.code 5종', () => {
    expect(SCORE_FACILITY_TYPES).toEqual([
      'street_light',
      'security_light',
      'cctv',
      'emergency_bell',
      'police',
    ]);
  });
});
