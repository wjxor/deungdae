import type { LatLng } from '../../../../shared/types'

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
