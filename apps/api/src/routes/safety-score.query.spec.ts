import { FACILITY_RADIUS_M, segmentScoreQuery } from './safety-score.query.js';

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
      [0, 1],
      [
        'SRID=4326;LINESTRING(127.4346 36.3323, 127.4349 36.3325)',
        'SRID=4326;LINESTRING(127.4349 36.3325, 127.4352 36.3327, 127.4355 36.333)',
      ],
      30,
    ]);
    expect(q.text).toContain(
      'ST_DWithin(f.location, ST_GeogFromText(s.wkt), $3::float8)',
    );
    expect(q.text).toContain('sum(ft.weight)');
    expect(q.text).toContain('JOIN facility_types ft ON ft.code = spot.type');
  });

  it('종류별로 같은 좌표는 한 곳으로 센다 (지점, ROADMAP "결정된 것" 안전점수)', () => {
    const q = segmentScoreQuery([
      [
        { lat: 36.3323, lng: 127.4346 },
        { lat: 36.3325, lng: 127.4349 },
      ],
    ]);

    // 좌표는 ST_AsBinary로 비교한다. 실험 스크립트의 spots와 같은 방식이고, 반올림하지 않은 완전히 같은 값만 같은 곳이다
    expect(q.text).toContain('SELECT DISTINCT s.i, f.type, ST_AsBinary(f.location)');
    expect(q.text).toContain('GROUP BY spot.i');
  });
});
