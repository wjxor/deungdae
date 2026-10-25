import { ApiException } from '../common/api-exception.js';
import { parseRouteSearchRequest } from './route-search.request.js';

const VALID = {
  origin: { lat: 36.3323, lng: 127.4346 },
  destination: { lat: 36.3371, lng: 127.4451 },
  mode: 'night',
};

describe('parseRouteSearchRequest', () => {
  it('API.md 3장 요청을 그대로 읽는다', () => {
    expect(parseRouteSearchRequest(VALID)).toEqual(VALID);
  });

  it.each([
    ['본문 없음', undefined],
    ['출발지 없음', { ...VALID, origin: undefined }],
    ['출발지가 배열', { ...VALID, origin: [36.3323, 127.4346] }],
    [
      '도착지 좌표가 문자열',
      { ...VALID, destination: { lat: '36.33', lng: '127.44' } },
    ],
    ['mode 없음', { ...VALID, mode: undefined }],
    ['mode가 다른 값', { ...VALID, mode: 'evening' }],
  ])('%s이면 400 INVALID_INPUT', (_, body) => {
    const e = (() => {
      try {
        parseRouteSearchRequest(body);
      } catch (err) {
        return err;
      }
    })();
    expect(e).toBeInstanceOf(ApiException);
    expect((e as ApiException).getStatus()).toBe(400);
    expect((e as ApiException).getResponse()).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
  });
});
