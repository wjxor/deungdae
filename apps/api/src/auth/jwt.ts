import { SignJWT, jwtVerify } from 'jose';

/** 로그인 토큰 유효 기간 (API.md 5장). 리프레시 토큰은 두지 않고 지나면 다시 로그인한다 */
export const ACCESS_TOKEN_TTL = '7d';

const ALG = 'HS256';

/** 비밀값 문자열을 HS256 키로 바꾼다 */
function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** 회원 id를 `sub`에 담은 로그인 토큰(HS256, 7일)을 만든다. 카카오 토큰은 담지 않는다 */
export function signAccessToken(
  userId: number,
  secret: string,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(keyOf(secret));
}

/** 로그인 토큰을 검증해 회원 id를 돌려준다. 서명·만료·형식이 틀리면 null */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      algorithms: [ALG],
    });
    const sub = payload.sub ?? '';
    return /^[1-9][0-9]*$/.test(sub) ? Number(sub) : null;
  } catch {
    return null;
  }
}
