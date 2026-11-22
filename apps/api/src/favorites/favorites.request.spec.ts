import { ApiException } from '../common/api-exception.js';
import {
  parseAddPlaceRequest,
  parseAddRouteRequest,
  parseFavoriteId,
} from './favorites.request.js';

const cnu = {
  id: '8394',
  name: '충남대학교',
  address: '대전 유성구 대학로 99',
  location: { lat: 36.3664, lng: 127.3446 },
};
const station = {
  id: '11084',
  name: '대전역',
  address: '대전 동구 중앙로 215',
  location: { lat: 36.3324, lng: 127.4342 },
};
const seoulCityHall = {
  id: '9999',
  name: '서울시청',
  address: '서울 중구 세종대로 110',
  location: { lat: 37.5663, lng: 126.9779 },
};

/** 던진 ApiException의 HTTP 상태와 code */
function errorOf(fn: () => unknown): { status: number; code: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiException) {
      const body = e.getResponse() as { error: { code: string } };
      return { status: e.getStatus(), code: body.error.code };
    }
    throw e;
  }
  throw new Error('던지지 않았다');
}

describe('parseAddPlaceRequest', () => {
  it('정상 장소는 Place 네 필드만 남긴다', () => {
    expect(
      parseAddPlaceRequest({ place: { ...cnu, extra: 'x' }, other: 1 }),
    ).toEqual({ place: cnu });
  });

  it('지도에서 고른 곳(주소 빈 문자열, map: ID)도 받는다', () => {
    const picked = {
      id: 'map:36.350400,127.384500',
      name: '지도에서 고른 도착지',
      address: '',
      location: { lat: 36.3504, lng: 127.3845 },
    };
    expect(parseAddPlaceRequest({ place: picked })).toEqual({ place: picked });
  });

  it.each([
    ['본문 없음', undefined],
    ['place 없음', {}],
    ['id 빈 문자열', { place: { ...cnu, id: '' } }],
    ['id 숫자', { place: { ...cnu, id: 8394 } }],
    ['name 빈 문자열', { place: { ...cnu, name: '' } }],
    ['address 없음', { place: { ...cnu, address: undefined } }],
    [
      '위도 문자열',
      { place: { ...cnu, location: { lat: '36.3', lng: 127.3 } } },
    ],
    ['name 101자', { place: { ...cnu, name: '가'.repeat(101) } }],
    ['id 201자', { place: { ...cnu, id: 'a'.repeat(201) } }],
    ['address 201자', { place: { ...cnu, address: '가'.repeat(201) } }],
  ])('%s → 400 INVALID_INPUT', (_, body) => {
    expect(errorOf(() => parseAddPlaceRequest(body))).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    });
  });

  it('name 100자·id 200자·address 200자까지는 받는다', () => {
    const long = {
      ...cnu,
      id: 'a'.repeat(200),
      name: '가'.repeat(100),
      address: '가'.repeat(200),
    };
    expect(parseAddPlaceRequest({ place: long })).toEqual({ place: long });
  });

  it('대전 밖 좌표 → 400 OUT_OF_AREA', () => {
    expect(
      errorOf(() => parseAddPlaceRequest({ place: seoulCityHall })),
    ).toEqual({ status: 400, code: 'OUT_OF_AREA' });
  });
});

describe('parseAddRouteRequest', () => {
  it('출발지·도착지가 있는 경로', () => {
    expect(
      parseAddRouteRequest({
        name: '대전역 → 충남대학교',
        origin: station,
        destination: cnu,
      }),
    ).toEqual({
      name: '대전역 → 충남대학교',
      origin: station,
      destination: cnu,
    });
  });

  it('출발지가 현재 위치(null)인 경로', () => {
    expect(
      parseAddRouteRequest({
        name: '현재 위치 → 충남대학교',
        origin: null,
        destination: cnu,
      }),
    ).toEqual({
      name: '현재 위치 → 충남대학교',
      origin: null,
      destination: cnu,
    });
  });

  it.each([
    ['name 없음', { origin: null, destination: cnu }],
    ['name 201자', { name: '가'.repeat(201), origin: null, destination: cnu }],
    ['destination 없음', { name: '경로', origin: null }],
    ['origin 생략(undefined)', { name: '경로', destination: cnu }],
    [
      'origin 형식 틀림',
      { name: '경로', origin: { id: 'x' }, destination: cnu },
    ],
  ])('%s → 400 INVALID_INPUT', (_, body) => {
    expect(errorOf(() => parseAddRouteRequest(body))).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    });
  });

  it('출발지나 도착지가 대전 밖이면 400 OUT_OF_AREA', () => {
    expect(
      errorOf(() =>
        parseAddRouteRequest({
          name: '경로',
          origin: seoulCityHall,
          destination: cnu,
        }),
      ),
    ).toEqual({ status: 400, code: 'OUT_OF_AREA' });
    expect(
      errorOf(() =>
        parseAddRouteRequest({
          name: '경로',
          origin: null,
          destination: seoulCityHall,
        }),
      ),
    ).toEqual({ status: 400, code: 'OUT_OF_AREA' });
  });
});

describe('parseFavoriteId', () => {
  it('양의 정수 문자열은 숫자로', () => {
    expect(parseFavoriteId('12')).toBe(12);
  });

  it.each(['0', '-1', '1.5', 'abc', '', '12abc', '99999999999'])(
    '%j → 400 INVALID_INPUT',
    (raw) => {
      expect(errorOf(() => parseFavoriteId(raw))).toEqual({
        status: 400,
        code: 'INVALID_INPUT',
      });
    },
  );
});
