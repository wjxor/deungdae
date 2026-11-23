import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { ApiError, ReportResponse } from '../../../shared/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { signAccessToken } from '../src/auth/jwt.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 실제 DB 없이 돌도록 reports INSERT($queryRaw)를 흉내 낸다. 회원은 5번만 있다
type Saved = { userId: unknown; values: unknown[] };
const saved: Saved[] = [];
const MEMBER_ID = 5;

const fakePrisma = {
  configured: true,
  $disconnect: vi.fn(),
  $queryRaw: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
    const userId = values[values.length - 1];
    if (userId !== MEMBER_ID) return Promise.resolve([]);
    saved.push({ userId, values });
    return Promise.resolve([
      { id: saved.length, createdAt: new Date('2026-11-23T12:30:00.000Z') },
    ]);
  }),
};

const SECRET = 'e2e-secret-0123456789-0123456789-abcdef';
const cnu = { lat: 36.3664, lng: 127.3446 };

describe('/api/reports (e2e)', () => {
  let app: INestApplication<App>;
  let auth: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    auth = `Bearer ${await signAccessToken(MEMBER_ID, SECRET)}`;
  });

  beforeEach(async () => {
    saved.length = 0;
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

  it('POST /api/reports — 회원 제보를 저장하고 201 { report }', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Authorization', auth)
      .send({ location: cnu, type: 'dark', description: ' 가로등 고장 ' })
      .expect(201);
    expect(res.body as ReportResponse).toEqual({
      report: {
        id: 1,
        location: cnu,
        type: 'dark',
        description: '가로등 고장',
        createdAt: '2026-11-23T21:30:00+09:00',
      },
    });
    expect(saved).toHaveLength(1);
  });

  it('설명 없이도 저장한다 (description null)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Authorization', auth)
      .send({ location: cnu, type: 'others' })
      .expect(201);
    expect((res.body as ReportResponse).report.description).toBeNull();
  });

  it('로그인 토큰이 없으면 401이고 저장하지 않는다', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .send({ location: cnu, type: 'dark' })
      .expect(401);
    expect((res.body as ApiError).error.code).toBe('UNAUTHORIZED');
    expect(saved).toHaveLength(0);
  });

  it('탈퇴한 회원의 토큰이면 401', async () => {
    const gone = `Bearer ${await signAccessToken(99, SECRET)}`;
    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Authorization', gone)
      .send({ location: cnu, type: 'dark' })
      .expect(401);
    expect((res.body as ApiError).error.code).toBe('UNAUTHORIZED');
  });

  it('우범지역(suspicious)은 400 INVALID_INPUT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Authorization', auth)
      .send({ location: cnu, type: 'suspicious' })
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('INVALID_INPUT');
    expect(saved).toHaveLength(0);
  });

  it('설명이 200자를 넘으면 400 INVALID_INPUT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Authorization', auth)
      .send({ location: cnu, type: 'dark', description: 'a'.repeat(201) })
      .expect(400);
    expect((res.body as ApiError).error).toEqual({
      code: 'INVALID_INPUT',
      message: '설명은 200자까지 쓸 수 있어요',
    });
  });

  it('대전 밖이면 400 OUT_OF_AREA', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Authorization', auth)
      .send({ location: { lat: 37.5665, lng: 126.978 }, type: 'dark' })
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('OUT_OF_AREA');
  });

  it('지도용 조회(GET /api/reports)는 만들지 않아 404', async () => {
    await request(app.getHttpServer()).get('/api/reports').expect(404);
  });
});
