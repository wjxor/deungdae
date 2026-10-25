import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { ApiError, FacilitiesResponse } from '../../../shared/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 실제 DB 없이 돌도록 시설 조회 쿼리만 가짜로 바꾼다
const fakePrisma = {
  configured: true,
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
};

const BBOX = '36.35,127.33,36.37,127.36';

describe('GET /api/facilities (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    fakePrisma.$queryRaw
      .mockReset()
      .mockResolvedValue([
        { id: 51877, type: 'cctv', lat: 36.3622, lng: 127.3471 },
      ]);
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

  it('API.md 4장 형식으로 답한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/facilities')
      .query({ bbox: BBOX })
      .expect(200);
    expect(res.body as FacilitiesResponse).toEqual({
      facilities: [
        { id: 51877, type: 'cctv', location: { lat: 36.3622, lng: 127.3471 } },
      ],
    });
  });

  it('bbox가 없으면 400 INVALID_INPUT (DB 안 부름)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/facilities')
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('INVALID_INPUT');
    expect(fakePrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('4km를 넘으면 400 BBOX_TOO_LARGE (DB 안 부름)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/facilities')
      .query({ bbox: '36.18,127.24,36.5,127.56' })
      .expect(400);
    expect(res.body as ApiError).toEqual({
      error: {
        code: 'BBOX_TOO_LARGE',
        message: expect.any(String) as unknown,
      },
    });
    expect(fakePrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('DB가 실패하면 502 EXTERNAL_API_ERROR', async () => {
    fakePrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = await request(app.getHttpServer())
      .get('/api/facilities')
      .query({ bbox: BBOX })
      .expect(502);
    expect((res.body as ApiError).error.code).toBe('EXTERNAL_API_ERROR');
  });
});
