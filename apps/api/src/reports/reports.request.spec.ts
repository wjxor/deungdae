import { ApiException } from '../common/api-exception.js';
import {
  parseCreateReportRequest,
  REPORT_DESCRIPTION_MAX,
} from './reports.request.js';

const cnu = { lat: 36.3664, lng: 127.3446 };

/** 던진 ApiException의 HTTP 상태와 에러 코드 */
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
  throw new Error('예외가 나지 않았다');
}

describe('parseCreateReportRequest', () => {
  it('좌표·유형·설명을 읽고 설명 앞뒤 빈칸을 지운다', () => {
    expect(
      parseCreateReportRequest({
        location: cnu,
        type: 'dark',
        description: '  가로등이 꺼져 있어요 ',
      }),
    ).toEqual({
      location: cnu,
      type: 'dark',
      description: '가로등이 꺼져 있어요',
    });
  });

  it('설명이 없거나 null이거나 빈칸뿐이면 null', () => {
    for (const description of [undefined, null, '', '   \n ']) {
      expect(
        parseCreateReportRequest({ location: cnu, type: 'others', description })
          .description,
      ).toBeNull();
    }
  });

  it('좌표 객체의 다른 필드는 버린다', () => {
    expect(
      parseCreateReportRequest({
        location: { ...cnu, extra: 1 },
        type: 'no_cctv',
      }).location,
    ).toEqual(cnu);
  });

  it('설명은 200자까지 받고 넘으면 400 INVALID_INPUT', () => {
    const ok = 'a'.repeat(REPORT_DESCRIPTION_MAX);
    expect(
      parseCreateReportRequest({ location: cnu, type: 'dark', description: ok })
        .description,
    ).toBe(ok);
    expect(
      errorOf(() =>
        parseCreateReportRequest({
          location: cnu,
          type: 'dark',
          description: `${ok}a`,
        }),
      ),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
  });

  it('우범지역(suspicious)·모르는 유형·빠진 유형은 400 INVALID_INPUT', () => {
    for (const type of ['suspicious', 'DARK', '', undefined, 1]) {
      expect(
        errorOf(() => parseCreateReportRequest({ location: cnu, type })),
      ).toEqual({ status: 400, code: 'INVALID_INPUT' });
    }
  });

  it('좌표가 숫자가 아니거나 빠지면 400 INVALID_INPUT', () => {
    for (const location of [
      undefined,
      null,
      { lat: '36.36', lng: 127.34 },
      { lat: 36.36 },
      [36.36, 127.34],
      { lat: 91, lng: 127.34 },
    ]) {
      expect(
        errorOf(() => parseCreateReportRequest({ location, type: 'dark' })),
      ).toEqual({ status: 400, code: 'INVALID_INPUT' });
    }
  });

  it('설명이 글자가 아니면 400 INVALID_INPUT', () => {
    expect(
      errorOf(() =>
        parseCreateReportRequest({
          location: cnu,
          type: 'dark',
          description: 5,
        }),
      ),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
  });

  it('본문이 객체가 아니면 400 INVALID_INPUT', () => {
    for (const body of [undefined, null, 'dark', 3]) {
      expect(errorOf(() => parseCreateReportRequest(body))).toEqual({
        status: 400,
        code: 'INVALID_INPUT',
      });
    }
  });

  it('대전 사각형 밖이면 400 OUT_OF_AREA (서울시청)', () => {
    expect(
      errorOf(() =>
        parseCreateReportRequest({
          location: { lat: 37.5665, lng: 126.978 },
          type: 'dark',
        }),
      ),
    ).toEqual({ status: 400, code: 'OUT_OF_AREA' });
  });
});
