import { SignJWT, UnsecuredJWT } from 'jose';
import { signAccessToken, verifyAccessToken } from './jwt.js';

const SECRET = 'test-secret-0123456789-0123456789-abcdef';

afterEach(() => {
  vi.useRealTimers();
});

describe('로그인 토큰 (JWT)', () => {
  it('발급한 토큰을 같은 비밀값으로 검증하면 회원 id가 나온다', async () => {
    const token = await signAccessToken(42, SECRET);
    expect(await verifyAccessToken(token, SECRET)).toBe(42);
  });

  it('다른 비밀값으로 만든 토큰이면 null', async () => {
    const token = await signAccessToken(
      42,
      'another-secret-0123456789-0123456789',
    );
    expect(await verifyAccessToken(token, SECRET)).toBeNull();
  });

  it('7일이 지나면 null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
    const token = await signAccessToken(42, SECRET);

    vi.setSystemTime(new Date('2026-11-19T23:59:59Z'));
    expect(await verifyAccessToken(token, SECRET)).toBe(42);

    vi.setSystemTime(new Date('2026-11-20T00:00:01Z'));
    expect(await verifyAccessToken(token, SECRET)).toBeNull();
  });

  it('서명이 없는 토큰(alg none)이나 깨진 문자열이면 null', async () => {
    const unsigned = new UnsecuredJWT({}).setSubject('42').encode();
    expect(await verifyAccessToken(unsigned, SECRET)).toBeNull();
    expect(await verifyAccessToken('not-a-token', SECRET)).toBeNull();
  });

  it('sub가 양의 정수 문자열이 아니면 null', async () => {
    const key = new TextEncoder().encode(SECRET);
    const sign = (sub: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setExpirationTime('1h')
        .sign(key);
    expect(await verifyAccessToken(await sign('abc'), SECRET)).toBeNull();
    expect(await verifyAccessToken(await sign('1.5'), SECRET)).toBeNull();
    expect(await verifyAccessToken(await sign('-3'), SECRET)).toBeNull();
  });
});
