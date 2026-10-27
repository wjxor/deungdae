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

// 점에서 경로(꺾은선)까지의 가장 짧은 거리(m). 경로 길이가 몇 km라 위도 한 도를 110.5km,
// 경도 한 도를 111.3km × cos(위도)로 보는 평면 근사로 충분하다 (이 범위의 오차는 1m보다 훨씬 작다)
export function distanceToPathM(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity
  const mPerLat = 110540
  const mPerLng = 111320 * Math.cos((p.lat * Math.PI) / 180)
  // p를 원점으로 한 평면 좌표(m)
  const xy = path.map((q) => ({ x: (q.lng - p.lng) * mPerLng, y: (q.lat - p.lat) * mPerLat }))
  let best = Math.hypot(xy[0].x, xy[0].y)
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1]
    const b = xy[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    // 원점에서 선분 ab에 내린 수선의 발. 선분 밖이면 가까운 끝점
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2))
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy))
  }
  return best
}
