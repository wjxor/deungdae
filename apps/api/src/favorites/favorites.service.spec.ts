import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Place } from '../../../../shared/types.js';
import { ApiException } from '../common/api-exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FavoritesService } from './favorites.service.js';

type Row = {
  id: number;
  userId: number;
  key: string;
  payload: Uint8Array;
  createdAt: Date;
};

/** 즐겨찾기 테이블 하나를 흉내 내는 메모리 배열. UNIQUE(user_id, key)도 지킨다 */
function fakeTable(keyField: 'placeKey' | 'routeKey') {
  const rows: Row[] = [];
  let nextId = 1;
  const view = (r: Row) => ({
    id: r.id,
    userId: r.userId,
    [keyField]: r.key,
    payload: r.payload,
    createdAt: r.createdAt,
  });
  const uniqueOf = (where: Record<string, Record<string, unknown>>) =>
    Object.values(where)[0] as { userId: number } & Record<string, string>;
  return {
    rows,
    findMany: vi.fn((args: { where: { userId: number } }) =>
      Promise.resolve(
        rows.filter((r) => r.userId === args.where.userId).map(view),
      ),
    ),
    findUnique: vi.fn(
      (args: { where: Record<string, Record<string, unknown>> }) => {
        const u = uniqueOf(args.where);
        const row = rows.find(
          (r) => r.userId === u.userId && r.key === u[keyField],
        );
        return Promise.resolve(row ? view(row) : null);
      },
    ),
    count: vi.fn((args: { where: { userId: number } }) =>
      Promise.resolve(
        rows.filter((r) => r.userId === args.where.userId).length,
      ),
    ),
    create: vi.fn(
      (args: {
        data: { userId: number; payload: Uint8Array } & Record<string, unknown>;
      }) => {
        const key = args.data[keyField] as string;
        if (rows.some((r) => r.userId === args.data.userId && r.key === key)) {
          return Promise.reject(
            Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            }),
          );
        }
        const row: Row = {
          id: nextId++,
          userId: args.data.userId,
          key,
          payload: args.data.payload,
          createdAt: new Date(),
        };
        rows.push(row);
        return Promise.resolve(view(row));
      },
    ),
    deleteMany: vi.fn((args: { where: { id: number; userId: number } }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (
          rows[i].id === args.where.id &&
          rows[i].userId === args.where.userId
        ) {
          rows.splice(i, 1);
        }
      }
      return Promise.resolve({ count: before - rows.length });
    }),
  };
}

const KEY = randomBytes(32).toString('base64');
const cnu: Place = {
  id: '8394',
  name: '충남대학교',
  address: '대전 유성구 대학로 99',
  location: { lat: 36.3664, lng: 127.3446 },
};
const station: Place = {
  id: '11084',
  name: '대전역',
  address: '대전 동구 중앙로 215',
  location: { lat: 36.3324, lng: 127.4342 },
};
const timeTower: Place = {
  id: '9001',
  name: '타임월드',
  address: '대전 서구 대덕대로 211',
  location: { lat: 36.3517, lng: 127.3786 },
};

function setup(
  env: Record<string, string | undefined> = { FAVORITES_KEY: KEY },
  configured = true,
) {
  const prisma = {
    configured,
    favoritePlace: fakeTable('placeKey'),
    favoriteRoute: fakeTable('routeKey'),
  };
  const config = {
    get: (name: string) => env[name],
  } as unknown as ConfigService;
  const service = new FavoritesService(
    prisma as unknown as PrismaService,
    config,
  );
  return { prisma, service };
}

/** 던진 ApiException의 HTTP 상태·code */
async function errorOf(
  p: Promise<unknown>,
): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiException) {
      const body = e.getResponse() as { error: { code: string } };
      return { status: e.getStatus(), code: body.error.code };
    }
    throw e;
  }
  throw new Error('던지지 않았다');
}

describe('FavoritesService 장소', () => {
  it('추가하면 목록에 복호화된 장소가 나오고, DB에는 암호문만 들어간다', async () => {
    const { prisma, service } = setup();
    const added = await service.addPlace(5, { place: cnu });
    expect(added.created).toBe(true);
    expect(await service.list(5)).toEqual({
      places: [{ id: added.favorite.id, place: cnu }],
      routes: [],
    });
    const stored = Buffer.from(prisma.favoritePlace.rows[0].payload).toString(
      'latin1',
    );
    expect(stored).not.toContain('대학로');
    expect(prisma.favoritePlace.rows[0].key).not.toContain('8394');
  });

  it('같은 장소를 두 번 추가하면 두 번째는 created: false이고 행은 하나', async () => {
    const { prisma, service } = setup();
    const first = await service.addPlace(5, { place: cnu });
    const second = await service.addPlace(5, { place: cnu });
    expect(second).toEqual({ favorite: first.favorite, created: false });
    expect(prisma.favoritePlace.rows).toHaveLength(1);
  });

  it('동시에 두 번 눌러 UNIQUE 위반(P2002)이 나도 기존 행을 돌려준다', async () => {
    const { prisma, service } = setup();
    const first = await service.addPlace(5, { place: cnu });
    // 확인 조회 때는 없었는데 저장 직전에 다른 요청이 먼저 넣은 경우
    prisma.favoritePlace.findUnique.mockResolvedValueOnce(null);
    const second = await service.addPlace(5, { place: cnu });
    expect(second).toEqual({ favorite: first.favorite, created: false });
  });

  it('같은 장소라도 다른 회원이면 따로 저장된다', async () => {
    const { prisma, service } = setup();
    await service.addPlace(5, { place: cnu });
    await service.addPlace(6, { place: cnu });
    expect(prisma.favoritePlace.rows).toHaveLength(2);
    expect((await service.list(6)).places).toHaveLength(1);
  });

  it('50개가 있으면 51번째는 400 INVALID_INPUT', async () => {
    const { service } = setup();
    for (let i = 0; i < 50; i++) {
      await service.addPlace(5, { place: { ...cnu, id: `p${i}` } });
    }
    expect(
      await errorOf(service.addPlace(5, { place: { ...cnu, id: 'p50' } })),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
  });

  it('50개가 차도 이미 저장한 장소는 다시 눌러도 200(created: false)', async () => {
    const { service } = setup();
    for (let i = 0; i < 50; i++) {
      await service.addPlace(5, { place: { ...cnu, id: `p${i}` } });
    }
    const again = await service.addPlace(5, { place: { ...cnu, id: 'p0' } });
    expect(again.created).toBe(false);
  });

  it('지우기는 그 회원의 행만 지운다 (남의 id면 아무것도 안 지움)', async () => {
    const { prisma, service } = setup();
    const mine = await service.addPlace(5, { place: cnu });
    await service.removePlace(6, mine.favorite.id);
    expect(prisma.favoritePlace.rows).toHaveLength(1);
    expect(prisma.favoritePlace.deleteMany).toHaveBeenCalledWith({
      where: { id: mine.favorite.id, userId: 6 },
    });
    await service.removePlace(5, mine.favorite.id);
    expect(prisma.favoritePlace.rows).toHaveLength(0);
  });

  it('없는 id를 지워도 에러가 아니다', async () => {
    const { service } = setup();
    await expect(service.removePlace(5, 999)).resolves.toBeUndefined();
  });

  it('목록은 저장한 순서(오래된 것 먼저)로 DB에 묻는다', async () => {
    const { prisma, service } = setup();
    await service.list(5);
    expect(prisma.favoritePlace.findMany).toHaveBeenCalledWith({
      where: { userId: 5 },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('다른 키로 저장된 행(복호화 실패)은 목록에서 빠지고 나머지는 나온다', async () => {
    const { prisma, service } = setup();
    await service.addPlace(5, { place: cnu });
    const other = setup({ FAVORITES_KEY: randomBytes(32).toString('base64') });
    // 다른 키를 쓰는 서버가 같은 DB에 넣은 행
    await other.service.addPlace(5, { place: station });
    prisma.favoritePlace.rows.push(other.prisma.favoritePlace.rows[0]);
    const { places } = await service.list(5);
    expect(places.map((p) => p.place.name)).toEqual(['충남대학교']);
  });
});

describe('FavoritesService 경로', () => {
  it('출발지가 현재 위치(null)인 경로를 저장하고 목록에서도 null', async () => {
    const { service } = setup();
    const added = await service.addRoute(5, {
      name: '현재 위치 → 충남대학교',
      origin: null,
      destination: cnu,
    });
    expect(added.created).toBe(true);
    expect((await service.list(5)).routes).toEqual([
      {
        id: added.favorite.id,
        name: '현재 위치 → 충남대학교',
        origin: null,
        destination: cnu,
      },
    ]);
  });

  it('도착지가 같아도 출발지가 다르면 다른 행이다', async () => {
    const { prisma, service } = setup();
    await service.addRoute(5, { name: 'a', origin: null, destination: cnu });
    await service.addRoute(5, { name: 'b', origin: station, destination: cnu });
    await service.addRoute(5, {
      name: 'c',
      origin: timeTower,
      destination: cnu,
    });
    expect(prisma.favoriteRoute.rows).toHaveLength(3);
  });

  it('같은 출발·도착은 한 번만 저장한다', async () => {
    const { prisma, service } = setup();
    await service.addRoute(5, { name: 'a', origin: station, destination: cnu });
    const again = await service.addRoute(5, {
      name: 'a',
      origin: station,
      destination: cnu,
    });
    expect(again.created).toBe(false);
    expect(prisma.favoriteRoute.rows).toHaveLength(1);
  });

  it('경로도 50개까지', async () => {
    const { service } = setup();
    for (let i = 0; i < 50; i++) {
      await service.addRoute(5, {
        name: `r${i}`,
        origin: null,
        destination: { ...cnu, id: `d${i}` },
      });
    }
    expect(
      await errorOf(
        service.addRoute(5, {
          name: 'r50',
          origin: null,
          destination: { ...cnu, id: 'd50' },
        }),
      ),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
  });

  it('경로 지우기도 그 회원의 행만', async () => {
    const { prisma, service } = setup();
    const r = await service.addRoute(5, {
      name: 'a',
      origin: null,
      destination: cnu,
    });
    await service.removeRoute(6, r.favorite.id);
    expect(prisma.favoriteRoute.rows).toHaveLength(1);
    await service.removeRoute(5, r.favorite.id);
    expect(prisma.favoriteRoute.rows).toHaveLength(0);
  });
});

describe('FavoritesService 설정·DB 실패', () => {
  it('FAVORITES_KEY가 없으면 502', async () => {
    const { service } = setup({});
    expect(await errorOf(service.list(5))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
    expect(await errorOf(service.addPlace(5, { place: cnu }))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });

  it('DATABASE_URL이 없으면(configured: false) 502', async () => {
    const { service } = setup(undefined, false);
    expect(await errorOf(service.list(5))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });

  it('DB 쿼리가 실패하면 502', async () => {
    const { prisma, service } = setup();
    prisma.favoritePlace.findMany.mockRejectedValueOnce(
      new Error('connection refused'),
    );
    expect(await errorOf(service.list(5))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });

  it('탈퇴한 회원의 남은 토큰으로 추가하면(FK 위반 P2003) 401', async () => {
    const { prisma, service } = setup();
    prisma.favoritePlace.create.mockRejectedValueOnce(
      Object.assign(new Error('Foreign key constraint violated'), {
        code: 'P2003',
      }),
    );
    expect(await errorOf(service.addPlace(5, { place: cnu }))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });
});
