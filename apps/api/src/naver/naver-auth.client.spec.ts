import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/api-exception.js';
import { NaverAuthClient } from './naver-auth.client.js';

const KEYS = {
  NAVER_CLIENT_ID: 'naver-id',
  NAVER_CLIENT_SECRET: 'naver-secret',
};

/** 환경변수 대신 주어진 값만 돌려주는 가짜 설정 */
function client(keys: Partial<typeof KEYS> = KEYS) {
  const config = {
    get: (name: keyof typeof KEYS) => keys[name],
  } as unknown as ConfigService;
  return new NaverAuthClient(config);
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

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NaverAuthClient.exchangeCode', () => {
  it('코드와 state로 토큰을 받는다 — 폼에 client_id·client_secret·code·state', async () => {
    const { lastCall } = stubFetch(() =>
      reply(200, '{"access_token":"naver-token","token_type":"bearer"}'),
    );
    expect(await client().exchangeCode('auth-code', 'st')).toBe('naver-token');

    const { url, init } = lastCall();
    expect(url).toBe('https://nid.naver.com/oauth2.0/token');
    expect(init.method).toBe('POST');
    const form = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'naver-id',
      client_secret: 'naver-secret',
      code: 'auth-code',
      state: 'st',
    });
  });

  it('네이버가 코드를 거부하면(200에 error) 401', async () => {
    stubFetch(() =>
      reply(
        200,
        '{"error":"invalid_request","error_description":"no valid data in session"}',
      ),
    );
    expect(await failure(client().exchangeCode('c', 's'))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it.each([
    ['클라이언트 설정 오류', 200, '{"error":"invalid_client"}'],
    ['네이버 장애', 503, 'Service Unavailable'],
    ['토큰이 없는 응답', 200, '{}'],
  ])('%s면 502', async (_, status, body) => {
    stubFetch(() => reply(status, body));
    expect(await failure(client().exchangeCode('c', 's'))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });

  it('시크릿이 없으면 네이버를 부르지 않고 502', async () => {
    const { fetchMock } = stubFetch(() => reply(200, '{}'));
    expect(
      await failure(
        client({ NAVER_CLIENT_ID: 'naver-id' }).exchangeCode('c', 's'),
      ),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('연결이 안 되면 502', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect(await failure(client().exchangeCode('c', 's'))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });
});

describe('NaverAuthClient.getProfile', () => {
  it('회원번호·별명을 받는다', async () => {
    const { lastCall } = stubFetch(() =>
      reply(
        200,
        '{"resultcode":"00","message":"success","response":{"id":"abcDEF123","nickname":"민수"}}',
      ),
    );
    expect(await client().getProfile('naver-token')).toEqual({
      providerId: 'abcDEF123',
      nickname: '민수',
    });
    const { url, init } = lastCall();
    expect(url).toBe('https://openapi.naver.com/v1/nid/me');
    expect(init.headers).toEqual({ Authorization: 'Bearer naver-token' });
  });

  it('별명이 없거나 비면 "등대 회원"', async () => {
    stubFetch(() =>
      reply(
        200,
        '{"resultcode":"00","response":{"id":"abcDEF123","nickname":" "}}',
      ),
    );
    expect(await client().getProfile('t')).toEqual({
      providerId: 'abcDEF123',
      nickname: '등대 회원',
    });
  });

  it.each([
    ['회원번호 없음', 200, '{"resultcode":"00","response":{}}'],
    [
      '토큰 거부',
      401,
      '{"resultcode":"024","message":"Authentication failed"}',
    ],
  ])('%s이면 502', async (_, status, body) => {
    stubFetch(() => reply(status, body));
    expect(await failure(client().getProfile('t'))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });
});

describe('NaverAuthClient.revoke', () => {
  it('토큰 삭제를 요청하고 result가 success면 끝난다', async () => {
    const { lastCall } = stubFetch(() =>
      reply(200, '{"access_token":"naver-token","result":"success"}'),
    );
    await client().revoke('naver-token');

    const { url, init } = lastCall();
    expect(url).toBe('https://nid.naver.com/oauth2.0/token');
    expect(init.method).toBe('POST');
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      grant_type: 'delete',
      client_id: 'naver-id',
      client_secret: 'naver-secret',
      access_token: 'naver-token',
      service_provider: 'NAVER',
    });
  });

  it.each([
    ['result가 success가 아님', 200, '{"error":"invalid_request"}'],
    ['네이버 장애', 500, ''],
  ])('%s면 502', async (_, status, body) => {
    stubFetch(() => reply(status, body));
    expect(await failure(client().revoke('t'))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });
});

describe('NaverAuthClient 로그', () => {
  it('실패해도 로그에 토큰·인가 코드·시크릿이 남지 않는다', async () => {
    const warn = vi.mocked(Logger.prototype.warn);
    stubFetch(() =>
      reply(200, '{"error":"invalid_client","error_description":"x"}'),
    );
    await failure(client().exchangeCode('secret-code-123', 's'));
    stubFetch(() => reply(500, 'oops'));
    await failure(client().revoke('naver-token-xyz'));

    const logged = warn.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('네이버');
    expect(logged).not.toMatch(/secret-code-123|naver-token-xyz|naver-secret/);
  });
});
