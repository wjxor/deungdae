import type { LatLng, Place } from '../../../../shared/types'

// 두 좌표 사이의 거리(m). 하버사인
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// 대전시청. 현재 위치를 못 잡았을 때의 기본 위치
export const DAEJEON_CENTER: LatLng = { lat: 36.3504, lng: 127.3845 }

// 대전을 감싸는 사각형. 서버 `DAEJEON_RECT`(apps/api/src/common/daejeon.ts, API.md 2장)와 같은 값이고 시설은 모두 이 안에 있다
export const DAEJEON_RECT = { minLat: 36.18, minLng: 127.24, maxLat: 36.5, maxLng: 127.56 } as const

// 대전 사각형 안인지. 서버 `isInDaejeonRect`(경로 검색의 `OUT_OF_AREA` 판정, API.md 3장)와 같다
export function isInDaejeonRect(p: LatLng): boolean {
  return p.lat >= DAEJEON_RECT.minLat && p.lat <= DAEJEON_RECT.maxLat && p.lng >= DAEJEON_RECT.minLng && p.lng <= DAEJEON_RECT.maxLng
}

// 지도를 눌러 고른 출발지·도착지. 좌표를 주소로 바꾸는 API는 두지 않아 이름 대신 이 문구를 쓴다 (REQUIREMENTS 화면 S2, API.md 2장).
// 둘 다 지도에서 고르면 S3 위쪽에 같은 이름이 나란히 나와서 출발지·도착지를 이름으로 나눈다
export const MAP_PICK_NAME = { origin: '지도에서 고른 출발지', destination: '지도에서 고른 도착지' } as const
export const mapPlace = (location: LatLng, role: keyof typeof MAP_PICK_NAME): Place => ({
  id: `map:${location.lat.toFixed(6)},${location.lng.toFixed(6)}`,
  name: MAP_PICK_NAME[role],
  address: '',
  location,
})
