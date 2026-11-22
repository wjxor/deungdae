import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type {
  ApiError,
  FavoritePlaceResponse,
  FavoriteRouteResponse,
  FavoritesResponse,
} from '../../../shared/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { signAccessToken } from '../src/auth/jwt.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 실제 DB 없이 돌도록 즐겨찾기 테이블 두 개를 메모리 배열로 흉내 낸다
type Row = {
  id: number;
  userId: number;
  key: string;
  payload: Uint8Array;
  createdAt: Date;
};

/** 즐겨찾기 테이블 하나. UNIQUE(user_id, key)만 지킨다 */
function fakeTable(keyField: 'placeKey' | 'routeKey') {
  let rows: Row[] = [];
  let nextId = 1;
  const view = (r: Row) => ({
    id: r.id,
    userId: r.userId,
    [keyField]: r.key,
    payload: r.payload,
    createdAt: r.createdAt,
  });
  return {
    reset: () => {
      rows = [];
      nextId = 1;
    },
    findMany: (args: { where: { userId: number } }) =>
      Promise.resolve(
        rows.filter((r) => r.userId === args.where.userId).map(view),
      ),
    findUnique: (args: {
      where: Record<string, { userId: number } & Record<string, string>>;
    }) => {
      const u = Object.values(args.where)[0];
      const row = rows.find(
        (r) => r.userId === u.userId && r.key === u[keyField],
      );
      return Promise.resolve(row ? view(row) : null);
    },
    count: (args: { where: { userId: number } }) =>
      Promise.resolve(
        rows.filter((r) => r.userId === args.where.userId).length,
      ),
    create: (args: {
      data: { userId: number; payload: Uint8Array } & Record<string, unknown>;
    }) => {
      const row: Row = {
        id: nextId++,
        userId: args.data.userId,
        key: args.data[keyField] as string,
        payload: args.data.payload,
        createdAt: new Date(),
      };
      rows.push(row);
      return Promise.resolve(view(row));
    },
    deleteMany: (args: { where: { id: number; userId: number } }) => {
      const before = rows.length;
      rows = rows.filter(
        (r) => !(r.id === args.where.id && r.userId === args.where.userId),
      );
      return Promise.resolve({ count: before - rows.length });
    },
  };
}

const fakePrisma = {
  configured: true,
  $disconnect: vi.fn(),
  favoritePlace: fakeTable('placeKey'),
  favoriteRoute: fakeTable('routeKey'),
};

const SECRET = 'e2e-secret-0123456789-0123456789-abcdef';
const cnu = {
  id: '8394',
  name: '충남대학교',
  address: '대전 유성구 대학로 99',
  location: { lat: 36.3664, lng: 127.3446 },
};

describe('/api/favorites (e2e)', () => {
  let app: INestApplication<App>;
  let auth: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.FAVORITES_KEY = randomBytes(32).toString('base64');
    auth = `Bearer ${await signAccessToken(5, SECRET)}`;
  });

  beforeEach(async () => {
    fakePrisma.favoritePlace.reset();
    fakePrisma.favoriteRoute.reset();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('토큰이 없으면 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/favorites')
      .expect(401);
    expect((res.body as ApiError).error.code).toBe('UNAUTHORIZED');
  });

  it('장소: 추가 201 → 같은 곳 200 → 목록 1개 → 삭제 204 → 목록 0개', async () => {
    const server = app.getHttpServer();
    const first = await request(server)
      .post('/api/favorites/places')
      .set('Authorization', auth)
      .send({ place: cnu })
      .expect(201);
    const { place } = first.body as FavoritePlaceResponse;
    expect(place.place).toEqual(cnu);

    const again = await request(server)
      .post('/api/favorites/places')
      .set('Authorization', auth)
      .send({ place: cnu })
      .expect(200);
    expect((again.body as FavoritePlaceResponse).place.id).toBe(place.id);

    const list = await request(server)
      .get('/api/favorites')
      .set('Authorization', auth)
      .expect(200);
    expect(list.body as FavoritesResponse).toEqual({
      places: [{ id: place.id, place: cnu }],
      routes: [],
    });

    await request(server)
      .delete(`/api/favorites/places/${place.id}`)
      .set('Authorization', auth)
      .expect(204);
    const after = await request(server)
      .get('/api/favorites')
      .set('Authorization', auth)
      .expect(200);
    expect((after.body as FavoritesResponse).places).toEqual([]);
  });

  it('경로: 현재 위치 출발로 추가 201 → 목록 → 삭제 204', async () => {
    const server = app.getHttpServer();
    const added = await request(server)
      .post('/api/favorites/routes')
      .set('Authorization', auth)
      .send({ name: '현재 위치 → 충남대학교', origin: null, destination: cnu })
      .expect(201);
    const { route } = added.body as FavoriteRouteResponse;
    expect(route).toEqual({
      id: route.id,
      name: '현재 위치 → 충남대학교',
      origin: null,
      destination: cnu,
    });

    const list = await request(server)
      .get('/api/favorites')
      .set('Authorization', auth)
      .expect(200);
    expect((list.body as FavoritesResponse).routes).toEqual([route]);

    await request(server)
      .delete(`/api/favorites/routes/${route.id}`)
      .set('Authorization', auth)
      .expect(204);
  });

  it('대전 밖 장소는 400 OUT_OF_AREA', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/favorites/places')
      .set('Authorization', auth)
      .send({ place: { ...cnu, location: { lat: 37.5663, lng: 126.9779 } } })
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('OUT_OF_AREA');
  });

  it('id가 숫자가 아니면 400 INVALID_INPUT', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/favorites/places/abc')
      .set('Authorization', auth)
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('INVALID_INPUT');
  });
});
