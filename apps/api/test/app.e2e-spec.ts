import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { HealthResponse } from '../../../shared/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 실제 DB 없이 돌도록 DB 연결만 가짜로 바꾼다
const fakePrisma = {
  configured: true,
  $queryRaw: vi.fn(() => Promise.resolve([])),
  $disconnect: vi.fn(),
};

describe('GET /api/health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // 로컬 .env에 CORS_ORIGINS가 있어도 같은 결과가 나오게 비운다
    vi.stubEnv('CORS_ORIGINS', '');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app.close();
  });

  it('API.md 1장 형식으로 답한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    const body = res.body as HealthResponse;
    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(body.time).toMatch(/\+09:00$/);
  });

  it('프론트 개발 서버(localhost:5173)에서 부를 수 있다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
  });

  it('CORS_ORIGINS에 없는 주소에는 허용 헤더를 주지 않는다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://deungdae-map.vercel.app')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS_ORIGINS (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    vi.stubEnv('CORS_ORIGINS', 'https://deungdae-map.vercel.app/');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app.close();
  });

  it('CORS_ORIGINS에 적은 배포 주소에서 부를 수 있다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://deungdae-map.vercel.app')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://deungdae-map.vercel.app',
    );
  });

  it('개발 서버도 그대로 열려 있다', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
  });
});
