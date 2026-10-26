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
    expect(q.text).toContain('JOIN facility_types ft ON ft.code = f.type');
  });
});
