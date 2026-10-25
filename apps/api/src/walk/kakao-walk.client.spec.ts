import type { ConfigService } from '@nestjs/config';
import {
  DAEJEON_STATION,
  WALK_OK,
  WOOSONG,
} from '../../test/fixtures/kakao-walk.js';
import { ApiException } from '../common/api-exception.js';
import { KakaoWalkClient } from './kakao-walk.client.js';

/** KAKAO_REST_API_KEY만 돌려주는 가짜 설정 */
function client(key: string | undefined) {
  const config = { get: () => key } as unknown as ConfigService;
  return new KakaoWalkClient(config);
}

/** fetch를 가짜로 바꾸고, 부른 URL·헤더를 확인할 수 있게 돌려준다 */
function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(impl);
  vi.stubGlobal('fetch', fetchMock);
  const lastCall = () => {
    // KakaoWalkClient는 URL을 문자열로 넘긴다
    const [input, init] = fetchMock.mock.calls.at(-1)!;
    return { url: new URL(input as string), init };
  };
  return { fetchMock, lastCall };
}

const respond = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    }),
  );

/** 던진 ApiException의 HTTP 상태와 code */
async function errorOf(promise: Promise<unknown>) {
  const e = await promise.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(ApiException);
  const body = (e as ApiException).getResponse() as {
    error: { code: string };
  };
  return { status: (e as ApiException).getStatus(), code: body.error.code };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KakaoWalkClient', () => {
  it('출발·도착은 x = 경도, y = 위도로 보내고 응답을 그대로 돌려준다', async () => {
    const { lastCall } = stubFetch(() => respond(200, WALK_OK));
    const res = await client('test-key').walk(
      DAEJEON_STATION,
      WOOSONG,
      'SHORTEST',
    );

    expect(res).toEqual(WALK_OK);
    const { url, init } = lastCall();
    expect(url.origin + url.pathname).toBe(
      'https://dapi.kakao.com/v2/routing/walk',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start_x: '127.434645',
      start_y: '36.332294',
      end_x: '127.44509',
      end_y: '36.33709',
      route_mode: 'SHORTEST',
    });
    expect(init?.headers).toEqual({ Authorization: 'KakaoAK test-key' });
  });

  it('경로를 못 찾은 응답(HTTP 200 + status)도 에러 없이 돌려준다', async () => {
    stubFetch(() => respond(200, { status: 'TOO_FAR_AWAY' }));
    const res = await client('test-key').walk(
      DAEJEON_STATION,
      WOOSONG,
      'SHORTEST',
    );
    expect(res.status).toBe('TOO_FAR_AWAY');
  });

  it.each([
    ['HTTP 429', () => respond(429, { errorType: 'RequestThrottled' })],
    [
      'HTTP 400 + code -10',
      () => respond(400, { code: -10, msg: 'API limit has been exceeded.' }),
    ],
  ])('%s이면 하루 한도 초과 503 QUOTA_EXCEEDED', async (_, impl) => {
    stubFetch(impl);
    expect(
      await errorOf(
        client('test-key').walk(DAEJEON_STATION, WOOSONG, 'SHORTEST'),
      ),
    ).toEqual({ status: 503, code: 'QUOTA_EXCEEDED' });
  });

  it.each([
    ['HTTP 401', () => respond(401, { errorType: 'AccessDeniedError' })],
    ['HTTP 400 (한도 아님)', () => respond(400, { code: -2 })],
    ['HTTP 500', () => respond(500, '')],
    ['연결 실패·시간 초과', () => Promise.reject(new Error('timeout'))],
    ['JSON이 아닌 응답', () => respond(200, '<html>')],
    ['status가 없는 응답', () => respond(200, { route: {} })],
  ])('%s이면 502 EXTERNAL_API_ERROR', async (_, impl) => {
    stubFetch(impl);
    expect(
      await errorOf(
        client('test-key').walk(DAEJEON_STATION, WOOSONG, 'SHORTEST'),
      ),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
  });

  it('REST 키가 없으면 카카오를 부르지 않고 502', async () => {
    const { fetchMock } = stubFetch(() => respond(200, WALK_OK));
    expect(
      await errorOf(
        client(undefined).walk(DAEJEON_STATION, WOOSONG, 'SHORTEST'),
      ),
    ).toEqual({ status: 502, code: 'EXTERNAL_API_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
