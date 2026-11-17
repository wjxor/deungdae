import { ApiException } from '../common/api-exception.js';
import {
  parseDeleteAccountRequest,
  parseKakaoLoginRequest,
  parseSocialLoginRequest,
} from './auth.request.js';

describe('parseKakaoLoginRequest', () => {
  it('code와 redirectUri를 꺼낸다', () => {
    expect(
      parseKakaoLoginRequest({
        code: 'auth-code',
        redirectUri: 'http://localhost:5173/',
        extra: 1,
      }),
    ).toEqual({ code: 'auth-code', redirectUri: 'http://localhost:5173/' });
  });

  it.each([
    ['본문 없음', undefined],
    ['code 없음', { redirectUri: 'http://localhost:5173/' }],
    ['code가 빈 문자열', { code: '', redirectUri: 'http://localhost:5173/' }],
    ['code가 숫자', { code: 1, redirectUri: 'http://localhost:5173/' }],
    ['redirectUri 없음', { code: 'c' }],
    ['redirectUri가 공백', { code: 'c', redirectUri: '  ' }],
  ])('%s이면 400 INVALID_INPUT', (_, body) => {
    let error: unknown;
    try {
      parseKakaoLoginRequest(body);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(400);
    expect((error as ApiException).getResponse()).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
  });
});

/** 400 INVALID_INPUT을 던지는지 */
function expectInvalid(run: () => unknown) {
  let error: unknown;
  try {
    run();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ApiException);
  expect((error as ApiException).getStatus()).toBe(400);
  expect((error as ApiException).getResponse()).toMatchObject({
    error: { code: 'INVALID_INPUT' },
  });
}

describe('parseSocialLoginRequest', () => {
  it('code·redirectUri·state를 꺼낸다', () => {
    expect(
      parseSocialLoginRequest({
        code: 'c',
        redirectUri: 'https://deungdae-map.vercel.app/',
        state: 's',
        extra: 1,
      }),
    ).toEqual({
      code: 'c',
      redirectUri: 'https://deungdae-map.vercel.app/',
      state: 's',
    });
  });

  it('state는 없어도 된다', () => {
    const req = parseSocialLoginRequest({
      code: 'c',
      redirectUri: 'http://localhost:5173/',
    });
    expect(req).toEqual({ code: 'c', redirectUri: 'http://localhost:5173/' });
    expect('state' in req).toBe(false);
  });

  it.each([
    ['본문 없음', undefined],
    ['code가 공백', { code: ' ', redirectUri: 'http://localhost:5173/' }],
    ['redirectUri 없음', { code: 'c' }],
    [
      'state가 숫자',
      { code: 'c', redirectUri: 'http://localhost:5173/', state: 3 },
    ],
    [
      'state가 빈 문자열',
      { code: 'c', redirectUri: 'http://localhost:5173/', state: '' },
    ],
  ])('%s이면 400 INVALID_INPUT', (_, body) => {
    expectInvalid(() => parseSocialLoginRequest(body));
  });
});

describe('parseDeleteAccountRequest', () => {
  it.each([
    ['본문 없음', undefined],
    ['null', null],
    ['빈 객체', {}],
  ])('%s이면 null (카카오 탈퇴는 본문이 없다)', (_, body) => {
    expect(parseDeleteAccountRequest(body)).toBeNull();
  });

  it('code가 있으면 SocialLoginRequest', () => {
    expect(
      parseDeleteAccountRequest({
        code: 'c',
        redirectUri: 'http://localhost:5173/',
        state: 's',
      }),
    ).toEqual({ code: 'c', redirectUri: 'http://localhost:5173/', state: 's' });
  });

  it('code가 있는데 redirectUri가 없으면 400', () => {
    expectInvalid(() => parseDeleteAccountRequest({ code: 'c' }));
  });
});
