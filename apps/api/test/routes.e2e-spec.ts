import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { ApiError, RouteSearchResponse } from '../../../shared/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { KakaoWalkClient } from '../src/walk/kakao-walk.client.js';
import { toWalkRoute } from '../src/walk/kakao-walk.convert.js';
import {
  DAEJEON_STATION,
  WALK_OK,
  WOOSONG,
  walkFailed,
} from './fixtures/kakao-walk.js';

// 실제 카카오·DB 없이 돌도록 둘 다 가짜로 바꾼다. 경로 캐시는 늘 비어 있고, 안전점수 쿼리는 시설이 없는 것처럼 답한다
const fakeWalk = { walk: vi.fn() };
const fakePrisma = {
  configured: true,
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
  routeCache: {
    findUnique: vi.fn(() => Promise.resolve(null)),
    upsert: vi.fn(() => Promise.resolve({})),
    deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
  },
};

const BODY = { origin: DAEJEON_STATION, destination: WOOSONG, mode: 'night' };

describe('POST /api/routes/search (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    fakeWalk.walk.mockReset().mockResolvedValue(WALK_OK);
    fakePrisma.$queryRaw.mockReset().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(KakaoWalkClient)
      .useValue(fakeWalk)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200으로 API.md 3장 형식을 답한다', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(BODY)
      .expect(200);
    const body = res.body as RouteSearchResponse;

    expect(body.recommended).toBe('safe');
    expect(body.sameRoute).toBe(true);
    expect(body.routes.map((r) => r.type)).toEqual(['shortest', 'safe']);
    const [shortest] = body.routes;
    expect(shortest).toMatchObject({
      distanceM: 342,
      durationS: 335,
      safetyScore: 0,
      level: 'danger',
    });
    expect(shortest.path[0]).toEqual({ lat: 36.33243907, lng: 127.43566206 });
    expect(shortest.segments[0]).toEqual({
      path: expect.any(Array) as unknown,
      distanceM: expect.any(Number) as unknown,
      safetyScore: 0,
      level: 'danger',
    });
    // 시설이 없어도 5종 키가 모두 있다
    expect(shortest.facilityCounts).toEqual({
      street_light: 0,
      security_light: 0,
      cctv: 0,
      emergency_bell: 0,
      police: 0,
    });
  });

  it('본문 형식이 틀리면 400 INVALID_INPUT (카카오 안 부름)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ ...BODY, mode: 'evening' })
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('INVALID_INPUT');
    expect(fakeWalk.walk).not.toHaveBeenCalled();
  });

  it('대전 밖이면 400 OUT_OF_AREA', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ ...BODY, destination: { lat: 37.5547, lng: 126.9707 } })
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('OUT_OF_AREA');
  });

  it('카카오가 출발지 근처 길을 못 찾으면 404 ORIGIN_UNREACHABLE', async () => {
    fakeWalk.walk.mockResolvedValue(walkFailed('START_LINK_NOT_FOUND'));
    const res = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(BODY)
      .expect(404);
    expect(res.body as ApiError).toEqual({
      error: {
        code: 'ORIGIN_UNREACHABLE',
        message: expect.any(String) as unknown,
      },
    });
  });

  it('최단·넓은 길 우선 두 후보를 부른다 (같은 경로면 sameRoute)', async () => {
    await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(BODY)
      .expect(200);
    const modes = fakeWalk.walk.mock.calls.map((c: unknown[]) => c[2]);
    expect(modes).toHaveLength(2);
    expect(modes).toEqual(expect.arrayContaining(['SHORTEST', 'BROAD_FIRST']));
  });

  it('제보가 쌓인 구간(FR-010)은 원점수에서 5를 빼서 위험이 된다', async () => {
    // 모든 구간에 가로등 5개(원점수 5 = 75점)가 있다고 답하고, 제보 감점 쿼리는 첫 구간만 고른다
    fakePrisma.$queryRaw.mockImplementation((sql: Prisma.Sql) => {
      if (sql.text.includes('reporter_key')) return Promise.resolve([{ i: 0 }]);
      if (sql.text.includes('AS raw')) {
        const ids = sql.values[2] as number[];
        return Promise.resolve(ids.map((i) => ({ i, raw: 5 })));
      }
      return Promise.resolve([]);
    });
    const res = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(BODY)
      .expect(200);
    const [shortest] = (res.body as RouteSearchResponse).routes;

    expect(shortest.segments[0]).toMatchObject({
      safetyScore: 0,
      level: 'danger',
    });
    expect(shortest.segments.slice(1).map((s) => s.safetyScore)).toEqual(
      shortest.segments.slice(1).map(() => 75),
    );
    expect(shortest.safetyScore).toBeLessThan(75);
  });

  it('A 보강(FR-006): 최단·큰길이 같은 길이면 경유지 경로를 같은 route_mode로 2건 더 부른다', async () => {
    // 가짜 카카오는 늘 같은 경로라 최단·큰길 겹침 100%. 경유지 후보 쿼리에만 경로 가운데 지점을 답한다
    const path = toWalkRoute(WALK_OK).path;
    const mid = path[Math.floor(path.length / 2)];
    fakePrisma.$queryRaw.mockImplementation((sql: Prisma.Sql) =>
      Promise.resolve(
        sql.text.includes('AS density') ? [{ ...mid, density: 6 }] : [],
      ),
    );
    await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({
        origin: path[0],
        destination: path[path.length - 1],
        mode: 'night',
      })
      .expect(200);

    const calls = fakeWalk.walk.mock.calls as unknown[][];
    expect(calls).toHaveLength(4);
    const withVia = calls.filter((c) => ((c[3] as unknown[]) ?? []).length > 0);
    expect(
      withVia.map((c) => String(c[2])).sort((a, b) => a.localeCompare(b)),
    ).toEqual(['BROAD_FIRST', 'SHORTEST']);
  });

  it('안전점수 쿼리가 실패하면 502 EXTERNAL_API_ERROR', async () => {
    fakePrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(BODY)
      .expect(502);
    expect((res.body as ApiError).error.code).toBe('EXTERNAL_API_ERROR');
  });
});
