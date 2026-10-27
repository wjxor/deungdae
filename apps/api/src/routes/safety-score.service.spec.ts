import { Logger } from '@nestjs/common';
import { ApiException } from '../common/api-exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SafetyScoreService } from './safety-score.service.js';

const PATHS = [
  [
    { lat: 36.3323, lng: 127.4346 },
    { lat: 36.3325, lng: 127.4349 },
  ],
  [
    { lat: 36.3325, lng: 127.4349 },
    { lat: 36.3327, lng: 127.4352 },
  ],
  [
    { lat: 36.3327, lng: 127.4352 },
    { lat: 36.333, lng: 127.4355 },
  ],
];

/** `$queryRaw`만 가짜로 둔 PrismaService */
function fakePrisma(configured = true) {
  const queryRaw = vi.fn();
  const prisma = {
    configured,
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  return { service: new SafetyScoreService(prisma), queryRaw };
}

/** 던진 ApiException의 HTTP 상태와 code */
async function errorOf(promise: Promise<unknown>) {
  const e = await promise.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(ApiException);
  const body = (e as ApiException).getResponse() as {
    error: { code: string };
  };
  return { status: (e as ApiException).getStatus(), code: body.error.code };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SafetyScoreService', () => {
  it('구간 순서대로 원점수, 시설이 없는 구간(행 없음)은 0', async () => {
    const { service, queryRaw } = fakePrisma();
    queryRaw.mockResolvedValue([
      { i: 2, raw: 7 },
      { i: 0, raw: 3 },
    ]);
    expect(await service.rawScores(PATHS)).toEqual([3, 0, 7]);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('구간이 없으면 쿼리하지 않는다', async () => {
    const { service, queryRaw } = fakePrisma();
    expect(await service.rawScores([])).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('DB가 설정되지 않았으면 502 EXTERNAL_API_ERROR', async () => {
    const { service, queryRaw } = fakePrisma(false);
    expect(await errorOf(service.rawScores(PATHS))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('DB 에러는 502, 로그에 구간 좌표를 남기지 않는다', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { service, queryRaw } = fakePrisma();
    queryRaw.mockRejectedValue(
      new Error('Raw query failed\nLINESTRING(127.4346 36.3323, …)'),
    );
    expect(await errorOf(service.rawScores(PATHS))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
    const logged = warn.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('안전점수 조회 실패');
    expect(logged).not.toMatch(/127\.4346|36\.3323/);
  });
});
