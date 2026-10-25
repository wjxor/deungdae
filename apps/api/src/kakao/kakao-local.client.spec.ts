import type { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/api-exception.js';
import { KakaoLocalClient } from './kakao-local.client.js';

/** KAKAO_REST_API_KEY만 돌려주는 가짜 설정 */
function client(key: string | undefined) {
  const config = { get: () => key } as unknown as ConfigService;
  return new KakaoLocalClient(config);
}

/** fetch를 가짜로 바꾸고, 부른 URL·헤더를 확인할 수 있게 돌려준다 */
function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(impl);
  vi.stubGlobal('fetch', fetchMock);
  const lastCall = () => {
    // KakaoLocalClient는 URL을 문자열로 넘긴다
    const [input, init] = fetchMock.mock.calls.at(-1)!;
    return { url: new URL(input as string), init };
  };
  return { fetchMock, lastCall };
}

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KakaoLocalClient', () => {
  it('키워드 검색: rect는 경도 먼저, near는 x·y만 보낸다 (거리순 정렬 안 함)', async () => {
    const { lastCall } = stubFetch(() => ok({ documents: [{ id: '1' }] }));
    const docs = await client('test-key').searchKeyword('충남대학교', {
      rect: { minLat: 36.18, minLng: 127.24, maxLat: 36.5, maxLng: 127.56 },
      near: { lat: 36.3664, lng: 127.3446 },
      size: 15,
    });

    expect(docs).toEqual([{ id: '1' }]);
    const { url, init } = lastCall();
    expect(url.origin + url.pathname).toBe(
      'https://dapi.kakao.com/v2/local/search/keyword.json',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: '충남대학교',
      size: '15',
      rect: '127.24,36.18,127.56,36.5',
      x: '127.3446',
      y: '36.3664',
    });
    expect(init?.headers).toEqual({ Authorization: 'KakaoAK test-key' });
  });

  it('키워드 검색: near가 없으면 정렬을 보내지 않는다 (카카오 기본 정확도순)', async () => {
    const { lastCall } = stubFetch(() => ok({ documents: [] }));
    await client('test-key').searchKeyword('궁동');
    expect(Object.fromEntries(lastCall().url.searchParams)).toEqual({
      query: '궁동',
    });
  });

  it('주소 검색: query와 size만 보낸다', async () => {
    const { lastCall } = stubFetch(() => ok({ documents: [] }));
    await client('test-key').searchAddress('대학로 99', 30);
    const { url } = lastCall();
    expect(url.pathname).toBe('/v2/local/search/address.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: '대학로 99',
      size: '30',
    });
  });

  it.each([
    [
      '2xx가 아닌 응답',
      () => Promise.resolve(new Response('{}', { status: 401 })),
    ],
    ['연결 실패·시간 초과', () => Promise.reject(new Error('timeout'))],
    [
      'JSON이 아닌 응답',
      () => Promise.resolve(new Response('<html>', { status: 200 })),
    ],
  ])('%s이면 502 EXTERNAL_API_ERROR', async (_, impl) => {
    stubFetch(impl);
    const error = await client('test-key')
      .searchKeyword('궁동')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(502);
    expect((error as ApiException).getResponse()).toMatchObject({
      error: { code: 'EXTERNAL_API_ERROR' },
    });
  });

  it('REST 키가 없으면 카카오를 부르지 않고 502', async () => {
    const { fetchMock } = stubFetch(() => ok({ documents: [] }));
    await expect(
      client(undefined).searchAddress('궁동'),
    ).rejects.toBeInstanceOf(ApiException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
