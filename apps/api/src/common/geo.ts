import type { LatLng } from '../../../../shared/types.js';

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 두 좌표 사이의 거리(m). 하버사인 (apps/web `lib/geo.ts`와 같은 식) */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * `"36.36,127.34"`(위도,경도) 문자열을 좌표로 바꾼다. 형식이 틀리면 null.
 * 숫자가 아닌 값, 개수가 다른 값, 범위를 넘는 값(위도 ±90·경도 ±180)은 틀린 것으로 본다
 */
export function parseLatLng(raw: string): LatLng | null {
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 2 || parts.some((s) => s === '')) return null;
  const [lat, lng] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
