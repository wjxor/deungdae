import { ApiException } from '../common/api-exception.js';
import { parseKakaoLoginRequest } from './auth.request.js';

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
