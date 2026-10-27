import type { ConfigService } from '@nestjs/config';
import {
  RISE_SET_20261025,
  RISE_SET_EMPTY,
  SUNRISE_20261025,
  SUNSET_20261025,
} from '../../test/fixtures/kasi-rise-set.js';
import { ApiException } from '../common/api-exception.js';
import {
  KasiRiseSetClient,
  kstTime,
  parseRiseSet,
} from './kasi-rise-set.client.js';

/** KASI_API_KEY만 돌려주는 가짜 설정 */
function client(key: string | undefined) {
  const config = { get: () => key } as unknown as ConfigService;
  return new KasiRiseSetClient(config);
}

/** fetch를 가짜로 바꾸고, 부른 URL을 확인할 수 있게 돌려준다 */
function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(impl);
  vi.stubGlobal('fetch', fetchMock);
  const lastUrl = () => new URL(fetchMock.mock.calls.at(-1)![0] as string);
  return { fetchMock, lastUrl };
}

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

/** 실제 응답에서 item 필드만 바꾼 응답 */
function withItem(fields: Record<string, unknown>) {
  const res = structuredClone(RISE_SET_20261025);
  Object.assign(res.response.body.items.item, fields);
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('kstTime', () => {
  it('끝 공백이 있는 HHMM을 그 날 한국 시각으로 바꾼다', () => {
    expect(kstTime('2026-10-25', '0646  ')).toEqual(SUNRISE_20261025);
  });

  it('HHMMSS도 읽는다', () => {
    expect(kstTime('2026-10-25', '121435')).toEqual(
      new Date('2026-10-25T12:14:35+09:00'),
    );
  });

  it('숫자로 와서 앞자리 0이 빠진 값을 다시 채운다', () => {
    expect(kstTime('2026-10-25', 646)).toEqual(SUNRISE_20261025);
    expect(kstTime('2026-10-25', 64612)).toEqual(
      new Date('2026-10-25T06:46:12+09:00'),
    );
  });

  it.each([['----  '], [''], ['2460'], ['0660'], ['06:46'], [null]])(
    '%j는 형식 오류로 던진다',
    (value) => {
      expect(() => kstTime('2026-10-25', value)).toThrow();
    },
  );
});

describe('parseRiseSet', () => {
  it('실제 응답에서 일출·일몰을 꺼낸다', () => {
    expect(parseRiseSet(RISE_SET_20261025, '2026-10-25')).toEqual({
      sunrise: SUNRISE_20261025,
      sunset: SUNSET_20261025,
    });
  });

  it('item이 배열로 와도 첫 항목을 쓴다', () => {
    const res = structuredClone(RISE_SET_20261025) as unknown as {
      response: { body: { items: { item: unknown } } };
    };
    res.response.body.items.item = [res.response.body.items.item];
    expect(parseRiseSet(res, '2026-10-25').sunset).toEqual(SUNSET_20261025);
  });

  it('결과가 없으면 던진다 (날짜·지역 이름이 틀렸을 때)', () => {
    expect(() => parseRiseSet(RISE_SET_EMPTY, '2026-10-25')).toThrow(
      '결과 없음',
    );
  });

  it('resultCode가 00이 아니면 던진다', () => {
    const res = structuredClone(RISE_SET_20261025);
    res.response.header.resultCode = '22';
    expect(() => parseRiseSet(res, '2026-10-25')).toThrow('resultCode 22');
  });

  it('요청과 다른 날짜면 던진다', () => {
    expect(() =>
      parseRiseSet(withItem({ locdate: 20261024 }), '2026-10-25'),
    ).toThrow('다른 날짜');
  });

  it('일출이 일몰보다 늦으면 던진다', () => {
    expect(() =>
      parseRiseSet(withItem({ sunrise: '1800  ' }), '2026-10-25'),
    ).toThrow();
  });

  it('응답 모양이 전혀 다르면 던진다', () => {
    expect(() => parseRiseSet(null, '2026-10-25')).toThrow();
    expect(() => parseRiseSet({}, '2026-10-25')).toThrow();
  });
});

describe('KasiRiseSetClient', () => {
  it('지역 이름·날짜·JSON 형식으로 부르고 일출·일몰을 돌려준다', async () => {
    const { lastUrl } = stubFetch(() => ok(RISE_SET_20261025));
    const sunTimes = await client('test-key').riseSet('2026-10-25', '대전');

    expect(sunTimes).toEqual({
      sunrise: SUNRISE_20261025,
      sunset: SUNSET_20261025,
    });
    const url = lastUrl();
    expect(url.origin + url.pathname).toBe(
      'https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/getAreaRiseSetInfo',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      serviceKey: 'test-key',
      location: '대전',
      locdate: '20261025',
      _type: 'json',
    });
  });

  it.each([
    [
      '키가 틀려 403',
      () => Promise.resolve(new Response('{}', { status: 403 })),
    ],
    ['연결 실패·시간 초과', () => Promise.reject(new Error('timeout'))],
    [
      'JSON이 아닌 응답',
      () => Promise.resolve(new Response('<xml>', { status: 200 })),
    ],
    ['결과가 빈 응답', () => ok(RISE_SET_EMPTY)],
  ])('%s이면 502 EXTERNAL_API_ERROR', async (_, impl) => {
    stubFetch(impl);
    const error = await client('test-key')
      .riseSet('2026-10-25', '대전')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(502);
    expect((error as ApiException).getResponse()).toMatchObject({
      error: { code: 'EXTERNAL_API_ERROR' },
    });
  });

  it('키가 없으면 천문연을 부르지 않고 502', async () => {
    const { fetchMock } = stubFetch(() => ok(RISE_SET_20261025));
    await expect(
      client(undefined).riseSet('2026-10-25', '대전'),
    ).rejects.toBeInstanceOf(ApiException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
