import { WALK_OK } from '../../test/fixtures/kakao-walk.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  RouteCacheService,
  roundLatLng,
  routeCacheKey,
} from './route-cache.service.js';

/** route_cache 쿼리만 가짜로 둔 PrismaService */
function fakePrisma(configured = true) {
  const routeCache = {
    findUnique: vi.fn(),
    upsert: vi.fn(() => Promise.resolve({})),
    deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
  };
  const prisma = { configured, routeCache } as unknown as PrismaService;
  return { service: new RouteCacheService(prisma), routeCache };
}

const KEY_INPUT = {
  provider: 'kakao',
  routeMode: 'SHORTEST',
  origin: { lat: 36.3323, lng: 127.4346 },
  destination: { lat: 36.3371, lng: 127.4451 },
  waypoints: [],
};

const ENTRY = {
  key: 'k',
  provider: 'kakao',
  routeMode: 'SHORTEST',
  response: WALK_OK,
  distanceM: 342,
  durationS: 335,
};

describe('roundLatLng', () => {
  it('소수점 4자리로 반올림한다', () => {
    expect(roundLatLng({ lat: 36.332294, lng: 127.434645 })).toEqual({
      lat: 36.3323,
      lng: 127.4346,
    });
  });
});

describe('routeCacheKey', () => {
  it('SHA-256 hex이고 좌표가 그대로 들어가지 않는다', () => {
    const key = routeCacheKey(KEY_INPUT);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('36.3323');
  });

  it('같은 입력이면 같은 키, 출발·도착을 바꾸거나 옵션이 다르면 다른 키', () => {
    const key = routeCacheKey(KEY_INPUT);
    expect(routeCacheKey({ ...KEY_INPUT })).toBe(key);
    expect(
      routeCacheKey({
        ...KEY_INPUT,
        origin: KEY_INPUT.destination,
        destination: KEY_INPUT.origin,
      }),
    ).not.toBe(key);
    expect(routeCacheKey({ ...KEY_INPUT, routeMode: 'BROAD_FIRST' })).not.toBe(
      key,
    );
    expect(
      routeCacheKey({
        ...KEY_INPUT,
        waypoints: [{ lat: 36.335, lng: 127.44 }],
      }),
    ).not.toBe(key);
  });
});

describe('RouteCacheService', () => {
  it('만료 전 행이면 저장한 응답을 돌려준다', async () => {
    const { service, routeCache } = fakePrisma();
    routeCache.findUnique.mockResolvedValue({
      response: WALK_OK,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await service.get('k')).toEqual(WALK_OK);
    expect(routeCache.findUnique).toHaveBeenCalledWith({
      where: { cacheKey: 'k' },
      select: { response: true, expiresAt: true },
    });
  });

  it('만료된 행이나 없는 행은 null', async () => {
    const { service, routeCache } = fakePrisma();
    routeCache.findUnique.mockResolvedValueOnce({
      response: WALK_OK,
      expiresAt: new Date(Date.now() - 1),
    });
    expect(await service.get('k')).toBeNull();
    routeCache.findUnique.mockResolvedValueOnce(null);
    expect(await service.get('k')).toBeNull();
  });

  it('저장은 24시간 뒤 만료로 upsert하고, 만료된 행을 지운다', async () => {
    const { service, routeCache } = fakePrisma();
    const before = Date.now();
    await service.put(ENTRY);

    const [args] = routeCache.upsert.mock.calls[0] as unknown as [
      { create: { expiresAt: Date; cacheKey: string; routeMode: string } },
    ];
    expect(args.create).toMatchObject({
      cacheKey: 'k',
      provider: 'kakao',
      routeMode: 'SHORTEST',
      response: WALK_OK,
      distanceM: 342,
      durationS: 335,
    });
    const ttl = args.create.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(ttl).toBeLessThan(24 * 60 * 60 * 1000 + 5_000);
    expect(routeCache.deleteMany).toHaveBeenCalledOnce();
  });

  it('DB가 설정되지 않았으면 쿼리하지 않는다', async () => {
    const { service, routeCache } = fakePrisma(false);
    expect(await service.get('k')).toBeNull();
    await service.put(ENTRY);
    expect(routeCache.findUnique).not.toHaveBeenCalled();
    expect(routeCache.upsert).not.toHaveBeenCalled();
  });

  it('DB 에러가 나도 던지지 않는다 (캐시 없이 경로 검색은 계속)', async () => {
    const { service, routeCache } = fakePrisma();
    routeCache.findUnique.mockRejectedValue(new Error('connection refused'));
    routeCache.upsert.mockRejectedValue(new Error('connection refused'));
    await expect(service.get('k')).resolves.toBeNull();
    await expect(service.put(ENTRY)).resolves.toBeUndefined();
  });
});
