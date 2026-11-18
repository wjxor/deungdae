import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type {
  ApiError,
  AuthResponse,
  MeResponse,
} from '../../../shared/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { unauthorized } from '../src/common/api-exception.js';
import { GoogleAuthClient } from '../src/google/google-auth.client.js';
import { KakaoAuthClient } from '../src/kakao/kakao-auth.client.js';
import { NaverAuthClient } from '../src/naver/naver-auth.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 실제 카카오·DB 없이 돌도록 둘 다 가짜로 바꾼다. 회원 한 명을 메모리에 둔다
type Row = {
  id: number;
  provider: string;
  providerId: string;
  nickname: string;
  email: string | null;
  createdAt: Date;
};
let stored: Row | null = null;

const fakePrisma = {
  configured: true,
  $disconnect: vi.fn(),
  user: {
    upsert: vi.fn(
      (args: { create: Omit<Row, 'id' | 'email' | 'createdAt'> }) => {
        stored ??= {
          id: 5,
          email: null,
          createdAt: new Date(),
          ...args.create,
        };
        return Promise.resolve(stored);
      },
    ),
    findUnique: vi.fn((args: { where: { id: number } }) =>
      Promise.resolve(stored?.id === args.where.id ? stored : null),
    ),
    delete: vi.fn(() => {
      const row = stored;
      stored = null;
      return Promise.resolve(row);
    }),
  },
};

const fakeKakao = {
  exchangeCode: vi.fn(),
  getProfile: vi.fn(),
  unlink: vi.fn(),
};
const fakeNaver = {
  exchangeCode: vi.fn(),
  getProfile: vi.fn(),
  revoke: vi.fn(),
};
const fakeGoogle = {
  exchangeCode: vi.fn(),
  getProfile: vi.fn(),
  revoke: vi.fn(),
};

const WEB = 'http://localhost:5173/';

describe('/api/auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(() => {
    process.env.JWT_SECRET = 'e2e-secret-0123456789-0123456789-abcdef';
  });

  beforeEach(async () => {
    stored = null;
    fakeKakao.exchangeCode.mockReset().mockResolvedValue('kakao-token');
    fakeKakao.getProfile.mockReset().mockResolvedValue({
      providerId: '1234567890123456789',
      nickname: '민수',
    });
    fakeKakao.unlink.mockReset().mockResolvedValue('unlinked');
    fakeNaver.exchangeCode.mockReset().mockResolvedValue('naver-token');
    fakeNaver.getProfile.mockReset().mockResolvedValue({
      providerId: 'naverId123',
      nickname: '네이버민수',
    });
    fakeNaver.revoke.mockReset().mockResolvedValue(undefined);
    fakeGoogle.exchangeCode.mockReset().mockResolvedValue('google-token');
    fakeGoogle.getProfile.mockReset().mockResolvedValue({
      providerId: '1098765432109876543210',
      nickname: '구글민수',
    });
    fakeGoogle.revoke.mockReset().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(KakaoAuthClient)
      .useValue(fakeKakao)
      .overrideProvider(NaverAuthClient)
      .useValue(fakeNaver)
      .overrideProvider(GoogleAuthClient)
      .useValue(fakeGoogle)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** 카카오 로그인으로 토큰을 받는다 */
  async function login(): Promise<AuthResponse> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/kakao')
      .send({ code: 'auth-code', redirectUri: WEB })
      .expect(200);
    return res.body as AuthResponse;
  }

  it('POST /api/auth/kakao → 200 { user, accessToken } (API.md 5장)', async () => {
    const body = await login();
    expect(body.user).toEqual({
      id: 5,
      nickname: '민수',
      email: null,
      provider: 'kakao',
    });
    expect(typeof body.accessToken).toBe('string');
    expect(fakeKakao.exchangeCode).toHaveBeenCalledWith('auth-code', WEB);
  });

  it('POST /api/auth/naver → 200 { user: { provider: "naver" }, accessToken }', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/naver')
      .send({ code: 'auth-code', redirectUri: WEB, state: 'st' })
      .expect(200);
    const body = res.body as AuthResponse;
    expect(body.user).toEqual({
      id: 5,
      nickname: '네이버민수',
      email: null,
      provider: 'naver',
    });
    expect(fakeNaver.exchangeCode).toHaveBeenCalledWith('auth-code', 'st');

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect((me.body as MeResponse).user.provider).toBe('naver');
  });

  it('POST /api/auth/google → 200 { user: { provider: "google" } }', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ code: 'auth-code', redirectUri: WEB })
      .expect(200);
    expect((res.body as AuthResponse).user.provider).toBe('google');
    expect(fakeGoogle.exchangeCode).toHaveBeenCalledWith('auth-code', WEB);
  });

  it('네이버 본문에 state가 없으면 400 INVALID_INPUT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/naver')
      .send({ code: 'auth-code', redirectUri: WEB })
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('INVALID_INPUT');
    expect(fakeNaver.exchangeCode).not.toHaveBeenCalled();
  });

  it('code가 없으면 400 INVALID_INPUT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/kakao')
      .send({ redirectUri: WEB })
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('INVALID_INPUT');
  });

  it('카카오가 코드를 거부하면 401 UNAUTHORIZED', async () => {
    fakeKakao.exchangeCode.mockRejectedValue(
      unauthorized('카카오 로그인을 다시 해 주세요'),
    );
    const res = await request(app.getHttpServer())
      .post('/api/auth/kakao')
      .send({ code: 'old', redirectUri: WEB })
      .expect(401);
    expect((res.body as ApiError).error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/auth/me — 토큰이 없으면 401, 받은 토큰이면 200 { user }', async () => {
    const none = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);
    expect((none.body as ApiError).error.code).toBe('UNAUTHORIZED');

    const { accessToken } = await login();
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((res.body as MeResponse).user.nickname).toBe('민수');
  });

  it('GET /api/auth/me — 틀린 토큰이면 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
    expect((res.body as ApiError).error.code).toBe('UNAUTHORIZED');
  });

  /** 네이버로 로그인해 토큰을 받는다 */
  async function loginWithNaver(): Promise<AuthResponse> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/naver')
      .send({ code: 'auth-code', redirectUri: WEB, state: 'st' })
      .expect(200);
    return res.body as AuthResponse;
  }

  it('네이버 회원 DELETE /api/auth/me + { code, redirectUri, state } → 204, 그 뒤 /me는 401', async () => {
    const { accessToken } = await loginWithNaver();
    await request(app.getHttpServer())
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: 'again', redirectUri: WEB, state: 'st2' })
      .expect(204);
    expect(fakeNaver.exchangeCode).toHaveBeenLastCalledWith('again', 'st2');
    expect(fakeNaver.revoke).toHaveBeenCalledWith('naver-token');
    expect(fakeKakao.unlink).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('네이버 회원이 본문 없이 DELETE하면 400이고 회원은 남는다', async () => {
    const { accessToken } = await loginWithNaver();
    const res = await request(app.getHttpServer())
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
    expect((res.body as ApiError).error.code).toBe('INVALID_INPUT');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('DELETE /api/auth/me → 204, 그 뒤 같은 토큰으로 /me는 401', async () => {
    const { accessToken } = await login();
    const del = await request(app.getHttpServer())
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    expect(del.text).toBe('');
    expect(fakeKakao.unlink).toHaveBeenCalledWith('1234567890123456789');

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    expect((res.body as ApiError).error.code).toBe('UNAUTHORIZED');
  });
});
