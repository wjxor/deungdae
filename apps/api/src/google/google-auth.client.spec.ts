import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/api-exception.js';
import { GoogleAuthClient } from './google-auth.client.js';

const KEYS = {
  GOOGLE_CLIENT_ID: 'google-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-secret',
};
const WEB = 'https://deungdae-map.vercel.app/';

/** 환경변수 대신 주어진 값만 돌려주는 가짜 설정 */
function client(keys: Partial<typeof KEYS> = KEYS) {
  const config = {
    get: (name: keyof typeof KEYS) => keys[name],
  } as unknown as ConfigService;
  return new GoogleAuthClient(config);
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

describe('GoogleAuthClient.exchangeCode', () => {
  it('코드와 redirectUri로 토큰을 받는다', async () => {
    const { lastCall } = stubFetch(() =>
      reply(200, '{"access_token":"google-token","id_token":"x.y.z"}'),
    );
    expect(await client().exchangeCode('auth-code', WEB)).toBe('google-token');

    const { url, init } = lastCall();
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      grant_type: 'authorization_code',
      client_id: 'google-id.apps.googleusercontent.com',
      client_secret: 'google-secret',
      code: 'auth-code',
      redirect_uri: WEB,
    });
  });

  it('구글이 코드를 거부하면(400 invalid_grant) 401', async () => {
    stubFetch(() =>
      reply(400, '{"error":"invalid_grant","error_description":"Bad Request"}'),
    );
    expect(await failure(client().exchangeCode('c', WEB))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it.each([
    ['클라이언트 설정 오류', 401, '{"error":"invalid_client"}'],
    ['리다이렉트 URI 불일치', 400, '{"error":"redirect_uri_mismatch"}'],
    ['구글 장애', 503, ''],
  ])('%s면 502', async (_, status, body) => {
    stubFetch(() => reply(status, body));
    expect(await failure(client().exchangeCode('c', WEB))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });

  it('시크릿이 없으면 구글을 부르지 않고 502', async () => {
    const { fetchMock } = stubFetch(() => reply(200, '{}'));
    expect(
      await failure(
        client({
          GOOGLE_CLIENT_ID: 'google-id.apps.googleusercontent.com',
        }).exchangeCode('c', WEB),
      ),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GoogleAuthClient.getProfile', () => {
  it('OpenID userinfo에서 sub·name을 받는다', async () => {
    const { lastCall } = stubFetch(() =>
      reply(200, '{"sub":"1098765432109876543210","name":"민수"}'),
    );
    expect(await client().getProfile('google-token')).toEqual({
      providerId: '1098765432109876543210',
      nickname: '민수',
    });
    const { url, init } = lastCall();
    expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect(init.headers).toEqual({ Authorization: 'Bearer google-token' });
  });

  it('이름이 없으면 "등대 회원"', async () => {
    stubFetch(() => reply(200, '{"sub":"1098765432109876543210"}'));
    expect(await client().getProfile('t')).toEqual({
      providerId: '1098765432109876543210',
      nickname: '등대 회원',
    });
  });

  it.each([
    ['sub 없음', 200, '{"name":"민수"}'],
    ['토큰 거부', 401, '{"error":"invalid_token"}'],
  ])('%s이면 502', async (_, status, body) => {
    stubFetch(() => reply(status, body));
    expect(await failure(client().getProfile('t'))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });
});

describe('GoogleAuthClient.revoke', () => {
  it('토큰 취소를 요청하고 200이면 끝난다', async () => {
    const { lastCall } = stubFetch(() => reply(200, '{}'));
    await client().revoke('google-token');

    const { url, init } = lastCall();
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(init.method).toBe('POST');
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({ token: 'google-token' });
  });

  it.each([
    ['토큰이 틀림', 400, '{"error":"invalid_token"}'],
    ['구글 장애', 500, ''],
  ])('%s이면 502', async (_, status, body) => {
    stubFetch(() => reply(status, body));
    expect(await failure(client().revoke('t'))).toEqual({
      status: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });
});

describe('GoogleAuthClient 로그', () => {
  it('실패해도 로그에 토큰·인가 코드·시크릿이 남지 않는다', async () => {
    const warn = vi.mocked(Logger.prototype.warn);
    stubFetch(() => reply(401, '{"error":"invalid_client"}'));
    await failure(client().exchangeCode('secret-code-123', WEB));
    stubFetch(() => reply(400, '{"error":"invalid_token"}'));
    await failure(client().revoke('google-token-xyz'));

    const logged = warn.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('Google');
    expect(logged).not.toMatch(
      /secret-code-123|google-token-xyz|google-secret/,
    );
  });
});
