import type { ConfigService } from '@nestjs/config';
import { ApiException, externalApiError } from '../common/api-exception.js';
import type { KakaoAuthClient } from '../kakao/kakao-auth.client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

const SECRET = 'test-secret-0123456789-0123456789-abcdef';
const WEB = 'https://deungdae-map.vercel.app/';

const ROW = {
  id: 5,
  provider: 'kakao',
  providerId: '1234567890123456789',
  nickname: '민수',
  email: null,
  createdAt: new Date('2026-11-13T00:00:00Z'),
};

const prisma = {
  configured: true,
  user: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
};
const kakao = { exchangeCode: vi.fn(), getProfile: vi.fn(), unlink: vi.fn() };

/** 주어진 환경변수만 돌려주는 가짜 설정으로 서비스를 만든다 */
function service(env: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    CORS_ORIGINS: 'https://deungdae-map.vercel.app',
    JWT_SECRET: SECRET,
    ...env,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigService;
  return new AuthService(
    prisma as unknown as PrismaService,
    kakao as unknown as KakaoAuthClient,
    config,
  );
}

/** ApiException이면 HTTP 상태와 에러 코드를 꺼낸다 */
async function failure(promise: Promise<unknown>) {
  const e = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiException);
  const ex = e as ApiException;
  const body = ex.getResponse() as { error: { code: string } };
  return { status: ex.getStatus(), code: body.error.code };
}

beforeEach(() => {
  prisma.configured = true;
  prisma.user.upsert.mockReset().mockResolvedValue(ROW);
  prisma.user.findUnique.mockReset().mockResolvedValue(ROW);
  prisma.user.delete.mockReset().mockResolvedValue(ROW);
  kakao.exchangeCode.mockReset().mockResolvedValue('kakao-token');
  kakao.getProfile.mockReset().mockResolvedValue({
    providerId: '1234567890123456789',
    nickname: '민수',
  });
  kakao.unlink.mockReset().mockResolvedValue('unlinked');
});

describe('AuthService.loginWithKakao', () => {
  it('카카오 회원번호로 회원을 찾거나 만들고, 회원 정보와 로그인 토큰을 돌려준다', async () => {
    const auth = service();
    const res = await auth.loginWithKakao({
      code: 'auth-code',
      redirectUri: WEB,
    });

    expect(kakao.exchangeCode).toHaveBeenCalledWith('auth-code', WEB);
    expect(kakao.getProfile).toHaveBeenCalledWith('kakao-token');
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: {
        provider_providerId: {
          provider: 'kakao',
          providerId: '1234567890123456789',
        },
      },
      create: {
        provider: 'kakao',
        providerId: '1234567890123456789',
        nickname: '민수',
      },
      update: { nickname: '민수' },
    });
    expect(res.user).toEqual({
      id: 5,
      nickname: '민수',
      email: null,
      provider: 'kakao',
    });
    expect(await auth.userIdFromToken(res.accessToken)).toBe(5);
  });

  it('허용되지 않은 redirectUri면 400이고 카카오를 부르지 않는다', async () => {
    expect(
      await failure(
        service().loginWithKakao({
          code: 'c',
          redirectUri: 'https://evil.example/',
        }),
      ),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
    expect(kakao.exchangeCode).not.toHaveBeenCalled();
  });

  it('카카오가 실패하면 그 에러를 그대로 넘긴다', async () => {
    kakao.exchangeCode.mockRejectedValue(externalApiError('x'));
    expect(
      await failure(service().loginWithKakao({ code: 'c', redirectUri: WEB })),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
  });

  it('DB 쿼리가 실패하면 502', async () => {
    prisma.user.upsert.mockRejectedValue(new Error('connection refused'));
    expect(
      await failure(service().loginWithKakao({ code: 'c', redirectUri: WEB })),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
  });

  it('DB 주소가 없으면 카카오를 부르기 전에 502', async () => {
    prisma.configured = false;
    expect(
      await failure(service().loginWithKakao({ code: 'c', redirectUri: WEB })),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
    expect(kakao.exchangeCode).not.toHaveBeenCalled();
  });

  it.each([
    ['없으면', undefined],
    ['32자보다 짧으면', 'short-secret'],
  ])('JWT_SECRET이 %s 카카오를 부르기 전에 502', async (_, secret) => {
    expect(
      await failure(
        service({ JWT_SECRET: secret }).loginWithKakao({
          code: 'c',
          redirectUri: WEB,
        }),
      ),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
    expect(kakao.exchangeCode).not.toHaveBeenCalled();
  });
});

describe('AuthService.userIdFromToken', () => {
  it('틀린 토큰이면 401', async () => {
    expect(await failure(service().userIdFromToken('not-a-token'))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });
});

describe('AuthService.me', () => {
  it('회원 정보를 돌려준다', async () => {
    expect(await service().me(5)).toEqual({
      id: 5,
      nickname: '민수',
      email: null,
      provider: 'kakao',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('회원이 없으면(탈퇴함) 401', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    expect(await failure(service().me(5))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });
});

describe('AuthService.deleteAccount', () => {
  it('카카오 연결을 끊은 뒤 회원을 지운다', async () => {
    await service().deleteAccount(5);
    expect(kakao.unlink).toHaveBeenCalledWith('1234567890123456789');
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(kakao.unlink.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.user.delete.mock.invocationCallOrder[0],
    );
  });

  it('사용자가 카카오에서 이미 연결을 끊었어도(not_linked) 회원을 지운다', async () => {
    kakao.unlink.mockResolvedValue('not_linked');
    await service().deleteAccount(5);
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('연결 끊기가 실패하면 회원을 지우지 않고 502', async () => {
    kakao.unlink.mockRejectedValue(externalApiError('x'));
    expect(await failure(service().deleteAccount(5))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('회원이 없으면 401이고 카카오를 부르지 않는다', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    expect(await failure(service().deleteAccount(5))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(kakao.unlink).not.toHaveBeenCalled();
  });
});
