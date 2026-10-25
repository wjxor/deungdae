import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { ApiError, DaylightResponse } from '../../../shared/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { externalApiError } from '../src/common/api-exception.js';
import { KasiRiseSetClient } from '../src/daylight/kasi-rise-set.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SUNRISE_20261025, SUNSET_20261025 } from './fixtures/kasi-rise-set.js';

// 실제 천문연·DB 없이 돌도록 둘 다 가짜로 바꾼다 (DB가 없으면 천문연 값만 씀)
const fakeKasi = { riseSet: vi.fn() };
const fakePrisma = { configured: false, $disconnect: vi.fn() };

describe('GET /api/daylight (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // Date만 고정한다 (supertest가 쓰는 타이머는 그대로)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T21:30:00+09:00'));
    fakeKasi.riseSet.mockReset().mockResolvedValue({
      sunrise: SUNRISE_20261025,
      sunset: SUNSET_20261025,
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(KasiRiseSetClient)
      .useValue(fakeKasi)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('API.md 1-1장 형식으로 답한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/daylight')
      .expect(200);
    expect(res.body as DaylightResponse).toEqual({
      sunrise: '2026-10-25T06:46:00+09:00',
      sunset: '2026-10-25T17:42:00+09:00',
      isNight: true,
    });
    expect(fakeKasi.riseSet).toHaveBeenCalledWith('2026-10-25', '대전');
  });

  it('천문연이 실패하면 502 EXTERNAL_API_ERROR', async () => {
    fakeKasi.riseSet.mockRejectedValue(externalApiError('실패'));
    const res = await request(app.getHttpServer())
      .get('/api/daylight')
      .expect(502);
    expect((res.body as ApiError).error.code).toBe('EXTERNAL_API_ERROR');
  });
});
