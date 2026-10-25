import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { ApiError, PlacesResponse } from '../../../shared/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { externalApiError } from '../src/common/api-exception.js';
import { KakaoLocalClient } from '../src/kakao/kakao-local.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 실제 카카오·DB 없이 돌도록 둘 다 가짜로 바꾼다
const fakeKakao = {
  searchKeyword: vi.fn(),
  searchAddress: vi.fn(),
};
const fakePrisma = { configured: false, $disconnect: vi.fn() };

describe('GET /api/places (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    fakeKakao.searchKeyword.mockReset().mockResolvedValue([
      {
        id: '12520707',
        place_name: '충남대학교 대덕캠퍼스',
        address_name: '대전 유성구 궁동 220',
        road_address_name: '대전 유성구 대학로 99',
        x: '127.3468',
        y: '36.3688',
      },
    ]);
    fakeKakao.searchAddress.mockReset().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(KakaoLocalClient)
      .useValue(fakeKakao)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('API.md 2장 형식으로 답한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/places')
      .query({ q: '충남대학교', near: '36.36,127.34' })
      .expect(200);
    expect(res.body as PlacesResponse).toEqual({
      places: [
        {
          id: '12520707',
          name: '충남대학교 대덕캠퍼스',
          address: '대전 유성구 대학로 99',
          location: { lat: 36.3688, lng: 127.3468 },
        },
      ],
    });
  });

  it('결과가 없으면 에러가 아니라 빈 목록', async () => {
    fakeKakao.searchKeyword.mockResolvedValue([]);
    const res = await request(app.getHttpServer())
      .get('/api/places')
      .query({ q: '서울역' })
      .expect(200);
    expect(res.body).toEqual({ places: [] });
  });

  it('q가 없으면 400 INVALID_INPUT (공통 에러 형식)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/places')
      .expect(400);
    expect(res.body as ApiError).toEqual({
      error: { code: 'INVALID_INPUT', message: '검색어를 입력해 주세요' },
    });
    expect(fakeKakao.searchKeyword).not.toHaveBeenCalled();
  });

  it('카카오가 실패하면 502 EXTERNAL_API_ERROR', async () => {
    fakeKakao.searchKeyword.mockRejectedValue(
      externalApiError('장소 검색 실패'),
    );
    const res = await request(app.getHttpServer())
      .get('/api/places')
      .query({ q: '궁동' })
      .expect(502);
    expect(res.body as ApiError).toEqual({
      error: { code: 'EXTERNAL_API_ERROR', message: '장소 검색 실패' },
    });
  });
});
