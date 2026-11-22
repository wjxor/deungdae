import { randomBytes } from 'node:crypto';
import {
  deriveFavoriteKeys,
  favoriteKey,
  openJson,
  sealJson,
} from './favorite-crypto.js';

const RAW_KEY = randomBytes(32).toString('base64');
const keys = deriveFavoriteKeys(RAW_KEY)!;
const place = {
  id: '8394',
  name: '충남대학교',
  address: '대전 유성구 대학로 99',
  location: { lat: 36.3664, lng: 127.3446 },
};

describe('deriveFavoriteKeys', () => {
  it('32바이트 base64면 암호화용·HMAC용 키를 따로 만든다', () => {
    expect(keys.enc).toHaveLength(32);
    expect(keys.mac).toHaveLength(32);
    expect(keys.enc.equals(keys.mac)).toBe(false);
  });

  it('없거나 비었거나 32바이트가 아니면 null', () => {
    expect(deriveFavoriteKeys(undefined)).toBeNull();
    expect(deriveFavoriteKeys('')).toBeNull();
    expect(deriveFavoriteKeys(randomBytes(16).toString('base64'))).toBeNull();
    expect(deriveFavoriteKeys(randomBytes(33).toString('base64'))).toBeNull();
  });
});

describe('sealJson · openJson', () => {
  it('암호화한 것을 풀면 같은 값이 나온다', () => {
    expect(openJson(keys, sealJson(keys, place))).toEqual(place);
  });

  it('맨 앞은 키 버전 1이고, 버전·IV·태그 뒤에 암호문이 온다', () => {
    const payload = sealJson(keys, place);
    expect(payload[0]).toBe(1);
    expect(payload.length).toBeGreaterThan(1 + 12 + 16);
  });

  it('같은 값도 암호화할 때마다 바이트가 다르다 (IV가 매번 무작위)', () => {
    const a = Buffer.from(sealJson(keys, place));
    const b = Buffer.from(sealJson(keys, place));
    expect(a.equals(b)).toBe(false);
  });

  it('암호문 한 바이트만 바뀌어도 풀지 못한다 (인증 태그)', () => {
    const payload = sealJson(keys, place);
    const tampered = Uint8Array.from(payload);
    tampered[tampered.length - 1] ^= 0x01;
    expect(openJson(keys, tampered)).toBeNull();
  });

  it('버전이 1이 아니면 풀지 않는다', () => {
    const payload = Uint8Array.from(sealJson(keys, place));
    payload[0] = 2;
    expect(openJson(keys, payload)).toBeNull();
  });

  it('다른 키로는 풀지 못한다', () => {
    const other = deriveFavoriteKeys(randomBytes(32).toString('base64'))!;
    expect(openJson(other, sealJson(keys, place))).toBeNull();
  });

  it('너무 짧은 값은 null', () => {
    expect(openJson(keys, new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('favoriteKey', () => {
  it('같은 회원·같은 ID면 늘 같은 64자 hex', () => {
    const a = favoriteKey(keys, 5, 'address:대전 유성구 대학로 99');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(favoriteKey(keys, 5, 'address:대전 유성구 대학로 99')).toBe(a);
  });

  it('같은 장소라도 회원이 다르면 값이 다르다', () => {
    expect(favoriteKey(keys, 5, '8394')).not.toBe(favoriteKey(keys, 6, '8394'));
  });

  it('장소 ID가 값에 그대로 드러나지 않는다', () => {
    expect(favoriteKey(keys, 5, '8394')).not.toContain('8394');
  });
});
