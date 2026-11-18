import type { ConfigService } from '@nestjs/config';
import { ApiException, externalApiError } from '../common/api-exception.js';
import type { GoogleAuthClient } from '../google/google-auth.client.js';
import type { KakaoAuthClient } from '../kakao/kakao-auth.client.js';
import type { NaverAuthClient } from '../naver/naver-auth.client.js';
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
const naver = { exchangeCode: vi.fn(), getProfile: vi.fn(), revoke: vi.fn() };
const google = { exchangeCode: vi.fn(), getProfile: vi.fn(), revoke: vi.fn() };

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
    naver as unknown as NaverAuthClient,
    google as unknown as GoogleAuthClient,
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
  naver.exchangeCode.mockReset().mockResolvedValue('naver-token');
  naver.getProfile.mockReset().mockResolvedValue({
    providerId: 'naverId123',
    nickname: '네이버민수',
  });
  naver.revoke.mockReset().mockResolvedValue(undefined);
  google.exchangeCode.mockReset().mockResolvedValue('google-token');
  google.getProfile.mockReset().mockResolvedValue({
    providerId: '1098765432109876543210',
    nickname: '구글민수',
  });
  google.revoke.mockReset().mockResolvedValue(undefined);
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

describe('AuthService.login (네이버·구글)', () => {
  it('네이버 — state로 토큰을 받고 (naver, 회원번호)로 회원을 찾거나 만든다', async () => {
    prisma.user.upsert.mockResolvedValue({
      ...ROW,
      provider: 'naver',
      providerId: 'naverId123',
      nickname: '네이버민수',
    });
    const auth = service();
    const res = await auth.login('naver', {
      code: 'auth-code',
      redirectUri: WEB,
      state: 'st',
    });

    expect(naver.exchangeCode).toHaveBeenCalledWith('auth-code', 'st');
    expect(naver.getProfile).toHaveBeenCalledWith('naver-token');
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: {
        provider_providerId: { provider: 'naver', providerId: 'naverId123' },
      },
      create: {
        provider: 'naver',
        providerId: 'naverId123',
        nickname: '네이버민수',
      },
      update: { nickname: '네이버민수' },
    });
    expect(res.user).toEqual({
      id: 5,
      nickname: '네이버민수',
      email: null,
      provider: 'naver',
    });
    expect(await auth.userIdFromToken(res.accessToken)).toBe(5);
    expect(kakao.exchangeCode).not.toHaveBeenCalled();
  });

  it('네이버인데 state가 없으면 400이고 네이버를 부르지 않는다', async () => {
    expect(
      await failure(service().login('naver', { code: 'c', redirectUri: WEB })),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
    expect(naver.exchangeCode).not.toHaveBeenCalled();
  });

  it('구글 — redirectUri로 토큰을 받고 (google, sub)로 회원을 찾거나 만든다', async () => {
    const res = await service().login('google', {
      code: 'auth-code',
      redirectUri: WEB,
    });

    expect(google.exchangeCode).toHaveBeenCalledWith('auth-code', WEB);
    expect(google.getProfile).toHaveBeenCalledWith('google-token');
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: {
        provider_providerId: {
          provider: 'google',
          providerId: '1098765432109876543210',
        },
      },
      create: {
        provider: 'google',
        providerId: '1098765432109876543210',
        nickname: '구글민수',
      },
      update: { nickname: '구글민수' },
    });
    expect(typeof res.accessToken).toBe('string');
  });

  it.each(['naver', 'google'] as const)(
    '%s — 허용되지 않은 redirectUri면 400이고 서비스를 부르지 않는다',
    async (provider) => {
      expect(
        await failure(
          service().login(provider, {
            code: 'c',
            redirectUri: 'https://evil.example/',
            state: 's',
          }),
        ),
      ).toEqual({ status: 400, code: 'INVALID_INPUT' });
      expect(naver.exchangeCode).not.toHaveBeenCalled();
      expect(google.exchangeCode).not.toHaveBeenCalled();
    },
  );

  it('카카오도 login으로 부를 수 있다 (loginWithKakao와 같음)', async () => {
    await service().login('kakao', { code: 'auth-code', redirectUri: WEB });
    expect(kakao.exchangeCode).toHaveBeenCalledWith('auth-code', WEB);
    expect(naver.exchangeCode).not.toHaveBeenCalled();
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

describe('AuthService.deleteAccount (네이버·구글 — 다시 로그인해 확인)', () => {
  const NAVER_ROW = { ...ROW, provider: 'naver', providerId: 'naverId123' };
  const GOOGLE_ROW = {
    ...ROW,
    provider: 'google',
    providerId: '1098765432109876543210',
  };
  const REAUTH = { code: 'again', redirectUri: WEB, state: 'st2' };

  it('네이버 — 다시 받은 코드의 회원번호가 같으면 연결을 끊고 지운다', async () => {
    prisma.user.findUnique.mockResolvedValue(NAVER_ROW);
    await service().deleteAccount(5, REAUTH);

    expect(naver.exchangeCode).toHaveBeenCalledWith('again', 'st2');
    expect(naver.revoke).toHaveBeenCalledWith('naver-token');
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(naver.revoke.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.user.delete.mock.invocationCallOrder[0],
    );
    expect(kakao.unlink).not.toHaveBeenCalled();
  });

  it('구글 — 같은 계정이면 토큰을 취소하고 지운다', async () => {
    prisma.user.findUnique.mockResolvedValue(GOOGLE_ROW);
    await service().deleteAccount(5, { code: 'again', redirectUri: WEB });

    expect(google.exchangeCode).toHaveBeenCalledWith('again', WEB);
    expect(google.revoke).toHaveBeenCalledWith('google-token');
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('다른 계정으로 다시 로그인했으면 400이고 끊지도 지우지도 않는다', async () => {
    prisma.user.findUnique.mockResolvedValue(NAVER_ROW);
    naver.getProfile.mockResolvedValue({
      providerId: 'someoneElse',
      nickname: '다른사람',
    });
    expect(await failure(service().deleteAccount(5, REAUTH))).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    });
    expect(naver.revoke).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('네이버는 계정을 고르는 화면이 없어서, 다른 계정이면 네이버에서 로그아웃한 뒤 다시 하라고 안내한다', async () => {
    prisma.user.findUnique.mockResolvedValue(NAVER_ROW);
    naver.getProfile.mockResolvedValue({
      providerId: 'someoneElse',
      nickname: '다른사람',
    });
    const e = await service()
      .deleteAccount(5, REAUTH)
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiException);
    const body = (e as ApiException).getResponse() as {
      error: { message: string };
    };
    expect(body.error.message).toBe(
      '로그인한 계정과 다른 네이버 계정이에요. 네이버에서 로그아웃한 뒤 같은 계정으로 다시 시도해 주세요',
    );
  });

  it('다시 로그인한 코드가 없으면 400이고 서비스를 부르지 않는다', async () => {
    prisma.user.findUnique.mockResolvedValue(GOOGLE_ROW);
    expect(await failure(service().deleteAccount(5))).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    });
    expect(google.exchangeCode).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('허용되지 않은 redirectUri면 400', async () => {
    prisma.user.findUnique.mockResolvedValue(NAVER_ROW);
    expect(
      await failure(
        service().deleteAccount(5, {
          ...REAUTH,
          redirectUri: 'https://evil.example/',
        }),
      ),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
    expect(naver.exchangeCode).not.toHaveBeenCalled();
  });

  it('연결 끊기가 실패하면 회원을 지우지 않고 502', async () => {
    prisma.user.findUnique.mockResolvedValue(NAVER_ROW);
    naver.revoke.mockRejectedValue(externalApiError('x'));
    expect(await failure(service().deleteAccount(5, REAUTH))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('카카오 회원은 본문이 와도 지금처럼 어드민 키로 끊고 지운다', async () => {
    await service().deleteAccount(5, REAUTH);
    expect(kakao.unlink).toHaveBeenCalledWith('1234567890123456789');
    expect(naver.exchangeCode).not.toHaveBeenCalled();
    expect(google.exchangeCode).not.toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });
});
