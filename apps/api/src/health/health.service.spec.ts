import { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

/** 테스트용 가짜 DB. `configured`와 `SELECT 1` 결과만 흉내 낸다 */
function fakePrisma(configured: boolean, query: () => Promise<unknown>) {
  const queryRaw = vi.fn(query);
  return {
    prisma: { configured, $queryRaw: queryRaw } as unknown as PrismaService,
    queryRaw,
  };
}

describe('HealthService', () => {
  it('DB가 답하면 db: ok', async () => {
    const { prisma } = fakePrisma(true, () =>
      Promise.resolve([{ '?column?': 1 }]),
    );
    const res = await new HealthService(prisma).check();
    expect(res.status).toBe('ok');
    expect(res.db).toBe('ok');
    expect(res.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });

  it('DB 쿼리가 실패하면 db: error, 서버 status는 ok', async () => {
    const { prisma } = fakePrisma(true, () =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );
    const res = await new HealthService(prisma).check();
    expect(res).toMatchObject({ status: 'ok', db: 'error' });
  });

  it('DATABASE_URL이 없으면 DB를 부르지 않고 db: error', async () => {
    const { prisma, queryRaw } = fakePrisma(false, () => Promise.resolve([]));
    const res = await new HealthService(prisma).check();
    expect(res.db).toBe('error');
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
