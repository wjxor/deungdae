import { waypointCandidateQuery } from './waypoint.query.js';

describe('waypointCandidateQuery', () => {
  const S = [
    { lat: 36.3323, lng: 127.4346 },
    { lat: 36.3325, lng: 127.4349 },
  ];
  const B = [
    { lat: 36.3323, lng: 127.4346 },
    { lat: 36.333, lng: 127.4355 },
  ];
  const q = waypointCandidateQuery({
    corridorPaths: [S, B],
    basePath: S,
    origin: { lat: 36.3323, lng: 127.4346 },
    destination: { lat: 36.333, lng: 127.4355 },
  });

  it('최단·큰길 100m 안, 기준 경로 60m 밖, 출발·도착 150m 밖의 시설 (경유지 실험 값)', () => {
    expect(q.values).toEqual([
      ['street_light', 'security_light'],
      30,
      5,
      10,
      'SRID=4326;MULTILINESTRING((127.4346 36.3323, 127.4349 36.3325), (127.4346 36.3323, 127.4355 36.333))',
      100,
      'SRID=4326;POINT(127.4346 36.3323)',
      150,
      'SRID=4326;POINT(127.4355 36.333)',
      150,
      'SRID=4326;MULTILINESTRING((127.4346 36.3323, 127.4349 36.3325))',
      60,
      'SRID=4326;MULTILINESTRING((127.4346 36.3323, 127.4349 36.3325))',
      300,
    ]);
  });

  it('밀집도는 서버 점수와 같은 식 — 같은 좌표는 한 곳, 가로등·보안등은 합쳐 5개까지, 원점수 10까지', () => {
    expect(q.text).toContain(
      'SELECT DISTINCT ON (f2.type, ST_AsBinary(f2.location))',
    );
    expect(q.text).toContain('WHERE NOT r.light OR r.rank <= $3::int');
    expect(q.text).toContain('), $4::float8)::float8 AS density');
    expect(q.text).toContain(
      'ORDER BY density DESC, ST_Distance(f.location, ST_GeogFromText($13)) ASC',
    );
  });
});
