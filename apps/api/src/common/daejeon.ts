/**
 * 대전광역시를 감싸는 사각형 (카카오 키워드 검색의 `rect`).
 * 정제한 시설 5종 75,251건이 모두 이 안에 있다 (위도 36.194~36.497, 경도 127.247~127.538 — 2026-10-25 `data/processed`).
 * 사각형이라 세종시 남쪽·계룡·옥천 일부도 들어가서, 결과는 `isDaejeonAddress`로 한 번 더 거른다
 */
export const DAEJEON_RECT = {
  minLat: 36.18,
  minLng: 127.24,
  maxLat: 36.5,
  maxLng: 127.56,
} as const;

/** 카카오 주소(`대전 유성구 궁동 220`)가 대전광역시 안인지. 카카오는 시도를 `대전`으로 줄여 쓴다 */
export function isDaejeonAddress(address: string): boolean {
  return /^대전(광역시)?( |$)/.test(address);
}
