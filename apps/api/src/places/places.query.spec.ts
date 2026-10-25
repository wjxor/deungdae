import { ApiException } from '../common/api-exception.js';
import { parsePlacesQuery } from './places.query.js';

/** 던진 예외의 HTTP 상태와 본문 */
function caught(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiException) {
      return { status: e.getStatus(), body: e.getResponse() };
    }
    throw e;
  }
  throw new Error('예외가 나지 않음');
}

describe('parsePlacesQuery', () => {
  it('q 앞뒤 공백을 빼고, near는 위도·경도로 읽는다', () => {
    expect(parsePlacesQuery('  충남대학교 ', '36.36,127.34')).toEqual({
      q: '충남대학교',
      near: { lat: 36.36, lng: 127.34 },
    });
  });

  it('near가 없으면 q만', () => {
    expect(parsePlacesQuery('궁동', undefined)).toEqual({ q: '궁동' });
  });

  it.each([undefined, '', '   ', ['a', 'b']])(
    'q가 %j이면 400 INVALID_INPUT',
    (q) => {
      expect(caught(() => parsePlacesQuery(q, undefined))).toEqual({
        status: 400,
        body: {
          error: { code: 'INVALID_INPUT', message: '검색어를 입력해 주세요' },
        },
      });
    },
  );

  it.each([
    '',
    'abc',
    '36.36',
    '36.36,',
    '36.36,127.34,1',
    '127.34,236.36',
    ['36.36,127.34'],
  ])('near가 %j이면 400 INVALID_INPUT', (near) => {
    expect(caught(() => parsePlacesQuery('궁동', near))).toMatchObject({
      status: 400,
      body: { error: { code: 'INVALID_INPUT' } },
    });
  });
});
