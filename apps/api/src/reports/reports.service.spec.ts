import { ApiException } from '../common/api-exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ReportsService } from './reports.service.js';

const cnu = { lat: 36.3664, lng: 127.3446 };
const newReport = {
  location: cnu,
  type: 'dark' as const,
  description: '가로등이 꺼져 있어요',
};

/** `$queryRaw` 태그 함수를 흉내 낸다. 넘어온 SQL 조각과 값을 기록한다 */
function fakePrisma(
  result: () => Promise<unknown>,
  configured = true,
): {
  prisma: PrismaService;
  queryRaw: ReturnType<typeof vi.fn>;
} {
  const queryRaw = vi.fn(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => result(),
  );
  return {
    prisma: { configured, $queryRaw: queryRaw } as unknown as PrismaService,
    queryRaw,
  };
}

/** 던진 ApiException의 HTTP 상태와 에러 코드 */
async function errorOf(
  promise: Promise<unknown>,
): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ApiException) {
      const body = e.getResponse() as { error: { code: string } };
      return { status: e.getStatus(), code: body.error.code };
    }
    throw e;
  }
  throw new Error('예외가 나지 않았다');
}

describe('ReportsService.create', () => {
  it('저장한 행의 id와 한국 시간 created_at으로 Report를 돌려준다', async () => {
    const { prisma } = fakePrisma(() =>
      Promise.resolve([
        { id: 7, createdAt: new Date('2026-11-23T12:30:00.000Z') },
      ]),
    );
    await expect(
      new ReportsService(prisma).create(5, newReport),
    ).resolves.toEqual({
      id: 7,
      location: cnu,
      type: 'dark',
      description: '가로등이 꺼져 있어요',
      createdAt: '2026-11-23T21:30:00+09:00',
    });
  });

  it('경도·위도 순서로 점을 만들고 회원 id로 users에서 고른다', async () => {
    const { prisma, queryRaw } = fakePrisma(() =>
      Promise.resolve([{ id: 1, createdAt: new Date() }]),
    );
    await new ReportsService(prisma).create(5, newReport);
    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join('?');
    expect(sql).toContain('INSERT INTO reports');
    expect(sql).toContain('FROM users');
    // ST_MakePoint(x = 경도, y = 위도) — 순서가 바뀌면 대전 밖 점이 된다
    expect(values).toEqual([
      cnu.lng,
      cnu.lat,
      'dark',
      '가로등이 꺼져 있어요',
      5,
    ]);
  });

  it('회원 행이 없으면(탈퇴한 회원의 토큰) 401 UNAUTHORIZED', async () => {
    const { prisma } = fakePrisma(() => Promise.resolve([]));
    expect(
      await errorOf(new ReportsService(prisma).create(5, newReport)),
    ).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('DB가 실패하면 502 EXTERNAL_API_ERROR', async () => {
    const { prisma } = fakePrisma(() =>
      Promise.reject(new Error('connection refused')),
    );
    expect(
      await errorOf(new ReportsService(prisma).create(5, newReport)),
    ).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });

  it('DATABASE_URL이 없으면 DB를 부르지 않고 502', async () => {
    const { prisma, queryRaw } = fakePrisma(() => Promise.resolve([]), false);
    expect(
      await errorOf(new ReportsService(prisma).create(5, newReport)),
    ).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
