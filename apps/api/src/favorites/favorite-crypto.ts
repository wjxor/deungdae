import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/**
 * 즐겨찾기 암호화 도구 (NFR-004). 장소 정보(이름·주소·좌표)를 서버에서 AES-256-GCM으로 암호화해 DB에 넣고,
 * 같은 곳을 두 번 저장하지 않게 장소 ID 대신 HMAC 값을 UNIQUE 키로 쓴다 — 장소 ID에도 주소·좌표가 들어 있어서.
 * 키는 서버 환경변수 `FAVORITES_KEY` 하나에서 용도별로 나눠 만든다. DB에는 암호문만 들어가고 키는 서버 밖으로 나가지 않는다
 */

/** 암호화용·HMAC용 키. 같은 키를 두 용도로 쓰지 않게 나눈다 */
export type FavoriteKeys = { enc: Buffer; mac: Buffer };

/** 암호문 맨 앞의 키 버전. 키를 바꾸게 되면 2로 올리고 옛 행을 다시 암호화한다 (학기 중에는 바꾸지 않음) */
const KEY_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * `FAVORITES_KEY`(32바이트 무작위 값의 base64)에서 암호화용·HMAC용 키를 HKDF-SHA256으로 만든다.
 * 없거나 디코드한 길이가 32바이트가 아니면 null — 호출하는 쪽이 즐겨찾기 요청을 502로 막는다
 */
export function deriveFavoriteKeys(
  raw: string | undefined,
): FavoriteKeys | null {
  if (!raw) return null;
  const master = Buffer.from(raw, 'base64');
  if (master.length !== KEY_LENGTH) return null;
  const derive = (info: string) =>
    Buffer.from(hkdfSync('sha256', master, '', info, KEY_LENGTH));
  return {
    enc: derive('deungdae-favorites-enc'),
    mac: derive('deungdae-favorites-mac'),
  };
}

/** 값을 JSON으로 바꿔 암호화한다. 결과는 버전(1바이트) + IV(12) + 인증 태그(16) + 암호문 */
export function sealJson(
  keys: FavoriteKeys,
  value: unknown,
): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keys.enc, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Uint8Array.from(
    Buffer.concat([Buffer.of(KEY_VERSION), iv, cipher.getAuthTag(), body]),
  );
}

/**
 * `sealJson`으로 만든 값을 풀어 JSON을 돌려준다. 버전이 다르거나 너무 짧거나,
 * 키가 다르거나 암호문이 바뀌어 인증 태그가 맞지 않으면 던지지 않고 null
 */
export function openJson(keys: FavoriteKeys, payload: Uint8Array): unknown {
  const bytes = Buffer.from(payload);
  if (bytes.length <= 1 + IV_LENGTH + TAG_LENGTH || bytes[0] !== KEY_VERSION) {
    return null;
  }
  const iv = bytes.subarray(1, 1 + IV_LENGTH);
  const tag = bytes.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  try {
    const decipher = createDecipheriv('aes-256-gcm', keys.enc, iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([
      decipher.update(bytes.subarray(1 + IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * 같은 곳 확인용 키 — HMAC-SHA256(`회원id:장소ID`)의 hex.
 * 회원 id를 넣어 서로 다른 회원이 같은 곳을 저장했는지도 DB에서 알 수 없게 하고,
 * 비밀 키가 있어야 계산할 수 있어 주소 목록을 넣어 보는 사전 대입으로 원래 ID를 알아낼 수 없다
 */
export function favoriteKey(
  keys: FavoriteKeys,
  userId: number,
  id: string,
): string {
  return createHmac('sha256', keys.mac).update(`${userId}:${id}`).digest('hex');
}
