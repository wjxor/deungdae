import type { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/api-exception.js';
import { KakaoAuthClient } from './kakao-auth.client.js';

const KEYS = {
  KAKAO_REST_API_KEY: 'rest-key',
  KAKAO_CLIENT_SECRET: 'client-secret',
  KAKAO_ADMIN_KEY: 'admin-key',
};

/** 환경변수 대신 주어진 값만 돌려주는 가짜 설정 */
function client(keys: Partial<typeof KEYS> = KEYS) {
  const config = {
    get: (name: keyof typeof KEYS) => keys[name],
  } as unknown as ConfigService;
  return new KakaoAuthClient(config);
}

/** fetch를 가짜로 바꾸고, 마지막 호출의 URL·요청을 돌려준다 */
function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(impl);
  vi.stubGlobal('fetch', fetchMock);
  const lastCall = () => {
    const [input, init] = fetchMock.mock.calls.at(-1)!;
    return { url: input as string, init: init! };
  };
  return { fetchMock, lastCall };
}

const reply = (status: number, body: string) =>
  Promise.resolve(new Response(body, { status }));

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KakaoAuthClient.exchangeCode', () => {
  it('토큰 요청을 폼 본문 다섯 값으로 보내고 카카오 액세스 토큰을 돌려준다', async () => {
    const { lastCall } = stubFetch(() =>
      reply(200, '{"access_token":"kakao-token","token_type":"bearer"}'),
    );
    const token = await client().exchangeCode(
      'auth-code',
      'https://deungdae-map.vercel.app/',
    );

    expect(token).toBe('kakao-token');
    const { url, init } = lastCall();
    expect(url).toBe('https://kauth.kakao.com/oauth/token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    });
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      grant_type: 'authorization_code',
      client_id: 'rest-key',
      redirect_uri: 'https://deungdae-map.vercel.app/',
      code: 'auth-code',
      client_secret: 'client-secret',
    });
  });

  it.each([
    ['만료·재사용한 코드 (KOE320)', 'KOE320'],
    ['인가 요청과 다른 redirect_uri (KOE303)', 'KOE303'],
  ])('%s면 401 UNAUTHORIZED', async (_, errorCode) => {
    stubFetch(() =>
      reply(
        400,
        JSON.stringify({ error: 'invalid_grant', error_code: errorCode }),
      ),
    );
    expect(
      await failure(client().exchangeCode('old', 'http://localhost:5173/')),
    ).toEqual({ status: 401, code: 'UNAUTHORIZED' });
  });

  it.each([
    [
      '우리 설정 문제 (invalid_client KOE010)',
      () => reply(401, '{"error":"invalid_client","error_code":"KOE010"}'),
    ],
    ['카카오 장애 (500)', () => reply(500, '')],
    ['연결 실패·시간 초과', () => Promise.reject(new Error('timeout'))],
    ['JSON이 아닌 응답', () => reply(200, '<html>')],
  ])('%s면 502 EXTERNAL_API_ERROR', async (_, impl) => {
    stubFetch(impl);
    expect(
      await failure(client().exchangeCode('c', 'http://localhost:5173/')),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
  });
});

describe('KakaoAuthClient.getProfile', () => {
  it('카카오 토큰으로 사용자 정보를 받고, 19자리 회원번호도 끝자리까지 문자열로 돌려준다', async () => {
    const { lastCall } = stubFetch(() =>
      reply(
        200,
        '{"id":1234567890123456789,"kakao_account":{"profile":{"nickname":"민수"}}}',
      ),
    );
    const profile = await client().getProfile('kakao-token');

    expect(profile).toEqual({
      providerId: '1234567890123456789',
      nickname: '민수',
    });
    const { url, init } = lastCall();
    expect(url).toBe('https://kapi.kakao.com/v2/user/me');
    expect(init.headers).toEqual({ Authorization: 'Bearer kakao-token' });
  });

  it.each([
    ['닉네임 항목이 없을 때', '{"id":7,"kakao_account":{}}'],
    [
      '닉네임이 빈 문자열일 때',
      '{"id":7,"kakao_account":{"profile":{"nickname":"  "}}}',
    ],
  ])('%s "등대 회원"', async (_, body) => {
    stubFetch(() => reply(200, body));
    expect(await client().getProfile('t')).toEqual({
      providerId: '7',
      nickname: '등대 회원',
    });
  });

  it('카카오가 실패하면 502', async () => {
    stubFetch(() =>
      reply(401, '{"msg":"this access token does not exist","code":-401}'),
    );
    expect(await failure(client().getProfile('t'))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });
});

describe('KakaoAuthClient.unlink', () => {
  it('어드민 키와 회원번호로 연결을 끊는다', async () => {
    const { lastCall } = stubFetch(() =>
      reply(200, '{"id":1234567890123456789}'),
    );
    expect(await client().unlink('1234567890123456789')).toBe('unlinked');

    const { url, init } = lastCall();
    expect(url).toBe('https://kapi.kakao.com/v1/user/unlink');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'KakaoAK admin-key',
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    });
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      target_id_type: 'user_id',
      target_id: '1234567890123456789',
    });
  });

  it('이미 연결이 끊긴 사용자(-101)면 not_linked', async () => {
    stubFetch(() =>
      reply(400, '{"msg":"NotRegisteredUserException","code":-101}'),
    );
    expect(await client().unlink('7')).toBe('not_linked');
  });

  it.each([
    ['다른 400 에러', () => reply(400, '{"msg":"invalid","code":-2}')],
    ['카카오 장애 (500)', () => reply(500, '')],
    ['연결 실패', () => Promise.reject(new Error('timeout'))],
  ])('%s면 502', async (_, impl) => {
    stubFetch(impl);
    expect(await failure(client().unlink('7'))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });
});

describe('KakaoAuthClient 키 없음', () => {
  it.each([
    ['REST 키', { KAKAO_CLIENT_SECRET: 's', KAKAO_ADMIN_KEY: 'a' }],
    ['클라이언트 시크릿', { KAKAO_REST_API_KEY: 'r', KAKAO_ADMIN_KEY: 'a' }],
  ])('%s가 없으면 카카오를 부르지 않고 토큰 받기가 502', async (_, keys) => {
    const { fetchMock } = stubFetch(() => reply(200, '{}'));
    expect(
      await failure(client(keys).exchangeCode('c', 'http://localhost:5173/')),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('어드민 키가 없으면 카카오를 부르지 않고 연결 끊기가 502', async () => {
    const { fetchMock } = stubFetch(() => reply(200, '{}'));
    expect(
      await failure(
        client({ KAKAO_REST_API_KEY: 'r', KAKAO_CLIENT_SECRET: 's' }).unlink(
          '7',
        ),
      ),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
