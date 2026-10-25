import { ApiException } from '../common/api-exception.js';
import { bboxSpanM, parseBboxQuery } from './facilities.query.js';

/** 던진 예외의 HTTP 상태와 code */
function caught(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiException) {
      const body = e.getResponse() as { error: { code: string } };
      return { status: e.getStatus(), code: body.error.code };
    }
    throw e;
  }
  throw new Error('예외가 나지 않음');
}

// 위도 36.34에서 위도 0.0359° ≈ 3,992m, 0.0361° ≈ 4,014m / 경도 0.0446° ≈ 3,995m, 0.0448° ≈ 4,013m
const SW = '36.34,127.37';

describe('parseBboxQuery', () => {
  it('남서·북동 모서리로 읽는다 (앞뒤 공백 허용)', () => {
    expect(parseBboxQuery(' 36.35, 127.33 ,36.37,127.36 ')).toEqual({
      sw: { lat: 36.35, lng: 127.33 },
      ne: { lat: 36.37, lng: 127.36 },
    });
  });

  it.each([
    undefined,
    '',
    'abc',
    '36.35,127.33,36.37',
    '36.35,127.33,36.37,127.36,1',
    '36.35,,36.37,127.36',
    '36.35,127.33,91,127.36',
    ['36.35,127.33,36.37,127.36'],
  ])('bbox가 %j이면 400 INVALID_INPUT', (bbox) => {
    expect(caught(() => parseBboxQuery(bbox))).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    });
  });

  it.each([
    ['남북이 뒤집힘', '36.37,127.33,36.35,127.36'],
    ['동서가 뒤집힘', '36.35,127.36,36.37,127.33'],
    ['위도·경도 순서가 뒤집힘', '127.33,36.35,127.36,36.37'],
  ])('%s이면 400 INVALID_INPUT', (_, bbox) => {
    expect(caught(() => parseBboxQuery(bbox))).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    });
  });

  it('가로·세로가 4km 안이면 통과', () => {
    expect(() =>
      parseBboxQuery(`${SW},${36.34 + 0.0359},${127.37 + 0.0446}`),
    ).not.toThrow();
  });

  it.each([
    ['세로가 4km를 넘음', `${SW},${36.34 + 0.0361},127.38`],
    ['가로가 4km를 넘음', `${SW},36.35,${127.37 + 0.0448}`],
    ['대전 전체', '36.18,127.24,36.5,127.56'],
  ])('%s이면 400 BBOX_TOO_LARGE', (_, bbox) => {
    expect(caught(() => parseBboxQuery(bbox))).toEqual({
      status: 400,
      code: 'BBOX_TOO_LARGE',
    });
  });

  it('점 하나(넓이 0)도 받는다', () => {
    expect(parseBboxQuery('36.35,127.33,36.35,127.33').sw).toEqual({
      lat: 36.35,
      lng: 127.33,
    });
  });
});

describe('bboxSpanM', () => {
  it('가로(남쪽 변)·세로(서쪽 변) 중 긴 쪽', () => {
    const span = bboxSpanM({
      sw: { lat: 36.34, lng: 127.37 },
      ne: { lat: 36.34 + 0.0359, lng: 127.37 + 0.0446 },
    });
    expect(span).toBeGreaterThan(3990);
    expect(span).toBeLessThan(4000);
  });
});
