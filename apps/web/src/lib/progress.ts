import type { LatLng } from '../../../../shared/types'

export type Progress = {
  remainingFraction: number // 경로 전체 중 아직 남은 비율 (0~1)
  alongM: number // 경로 시작부터 내 위치(경로에 가장 가까운 점)까지 온 길이(m)
  totalM: number // 경로 전체 길이(m). alongM과 같은 계산으로 잰 값
  offRouteM: number // 경로에서 떨어진 거리(m)
}

const M_PER_LAT = 110540

// 내 위치를 경로(꺾은선)에 가장 가까운 점으로 옮겨 놓고, 거기서 끝까지 남은 비율과 경로에서 떨어진 거리를 구한다.
// range를 주면 경로 시작부터 그 길이 범위에 걸친 선분만 본다. 경로가 되돌아오는 모양(ㄷ자 등)에서 GPS 오차로
// 아직 안 간 뒤쪽 길에 잡히지 않게, 이동 중에는 지금까지 온 곳 근처만 찾는다. 범위에 선분이 없으면 offRouteM이 Infinity.
// 거리 계산은 distanceToPathM(geo.ts)과 같은 평면 근사다 (몇 km 안의 오차는 1m보다 훨씬 작다)
export function routeProgress(p: LatLng, path: LatLng[], range?: { fromM: number; toM: number }): Progress {
  if (path.length < 2) return { remainingFraction: 1, alongM: 0, totalM: 0, offRouteM: path.length === 0 ? Infinity : 0 }
  const mPerLng = 111320 * Math.cos((p.lat * Math.PI) / 180)
  const xy = path.map((q) => ({ x: (q.lng - p.lng) * mPerLng, y: (q.lat - p.lat) * M_PER_LAT }))

  const lens: number[] = []
  let total = 0
  for (let i = 1; i < xy.length; i++) {
    const len = Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y)
    lens.push(len)
    total += len
  }
  if (total === 0) return { remainingFraction: 1, alongM: 0, totalM: 0, offRouteM: Math.hypot(xy[0].x, xy[0].y) }

  let best = Infinity
  let along = 0 // 가장 가까운 점까지 경로를 따라 온 길이
  let before = 0 // 그 선분 앞까지의 누적 길이
  for (let i = 1; i < xy.length; i++) {
    if (range && (before + lens[i - 1] < range.fromM || before > range.toM)) {
      before += lens[i - 1]
      continue
    }
    const a = xy[i - 1]
    const b = xy[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    // 내 위치(원점)에서 선분 ab에 내린 수선의 발. 선분 밖이면 가까운 끝점
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2))
    const d = Math.hypot(a.x + t * dx, a.y + t * dy)
    if (d < best) {
      best = d
      along = before + t * lens[i - 1]
    }
    before += lens[i - 1]
  }
  return { remainingFraction: 1 - along / total, alongM: along, totalM: total, offRouteM: best }
}

const segLenM = (a: LatLng, b: LatLng, mPerLng: number) => Math.hypot((b.lng - a.lng) * mPerLng, (b.lat - a.lat) * M_PER_LAT)

// 경로(꺾은선)에서 시작부터 fromM만큼 지나온 앞부분을 잘라 낸 나머지. 잘린 지점은 두 점 사이를 보간한 점이다.
// 지나온 길을 지도에서 지울 때 쓴다. 다 지났으면 끝점 하나만 남는다
export function pathFrom(path: LatLng[], fromM: number): LatLng[] {
  if (fromM <= 0 || path.length < 2) return path
  const mPerLng = 111320 * Math.cos((path[0].lat * Math.PI) / 180)
  let left = fromM
  for (let i = 1; i < path.length; i++) {
    const len = segLenM(path[i - 1], path[i], mPerLng)
    if (left < len) {
      const t = left / len
      const a = path[i - 1]
      const b = path[i]
      return [{ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, ...path.slice(i)]
    }
    left -= len
  }
  return [path[path.length - 1]]
}

export function pathLengthM(path: LatLng[]): number {
  if (path.length < 2) return 0
  const mPerLng = 111320 * Math.cos((path[0].lat * Math.PI) / 180)
  let sum = 0
  for (let i = 1; i < path.length; i++) sum += segLenM(path[i - 1], path[i], mPerLng)
  return sum
}
