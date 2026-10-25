import { Logger } from '@nestjs/common';
import { ApiException } from '../common/api-exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FacilitiesService } from './facilities.service.js';

const BBOX = {
  sw: { lat: 36.35, lng: 127.33 },
  ne: { lat: 36.37, lng: 127.36 },
};

/** `$queryRaw`만 가짜로 둔 PrismaService */
function fakePrisma(configured = true) {
  const queryRaw = vi.fn();
  const prisma = {
    configured,
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  return { service: new FacilitiesService(prisma), queryRaw };
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

describe('FacilitiesService', () => {
  it('DB 행을 API.md 4장 Facility로 바꾼다', async () => {
    const { service, queryRaw } = fakePrisma();
    queryRaw.mockResolvedValue([
      { id: 51877, type: 'cctv', lat: 36.3622, lng: 127.3471 },
      { id: 74012, type: 'emergency_bell', lat: 36.361, lng: 127.345 },
    ]);
    expect(await service.findInBbox(BBOX)).toEqual({
      facilities: [
        { id: 51877, type: 'cctv', location: { lat: 36.3622, lng: 127.3471 } },
        {
          id: 74012,
          type: 'emergency_bell',
          location: { lat: 36.361, lng: 127.345 },
        },
      ],
    });
  });

  it('bbox는 경도·위도 순(ST_MakeEnvelope)으로 넘기고, 지도에 띄우는 3종만 찾는다', async () => {
    const { service, queryRaw } = fakePrisma();
    queryRaw.mockResolvedValue([]);
    await service.findInBbox(BBOX);

    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(values).toEqual([127.33, 36.35, 127.36, 36.37]);
    const sql = strings.join('?');
    expect(sql).toContain("type IN ('cctv', 'emergency_bell', 'police')");
    expect(sql).not.toMatch(/street_light|security_light/);
  });

  it('결과가 없으면 빈 목록', async () => {
    const { service, queryRaw } = fakePrisma();
    queryRaw.mockResolvedValue([]);
    expect(await service.findInBbox(BBOX)).toEqual({ facilities: [] });
  });

  it('DB가 설정되지 않았으면 쿼리하지 않고 502 EXTERNAL_API_ERROR', async () => {
    const { service, queryRaw } = fakePrisma(false);
    expect(await errorOf(service.findInBbox(BBOX))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('DB 에러는 502 EXTERNAL_API_ERROR, 로그에 지도 범위를 남기지 않는다', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { service, queryRaw } = fakePrisma();
    queryRaw.mockRejectedValue(
      new Error('Raw query failed\nparams: [127.33, 36.35, 127.36, 36.37]'),
    );
    expect(await errorOf(service.findInBbox(BBOX))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
    const logged = warn.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('시설 조회 실패');
    expect(logged).not.toMatch(/36\.35|127\.33/);
  });
});
