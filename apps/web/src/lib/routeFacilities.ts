import type { Facility, FacilityType, LatLng, Route, RouteType } from '../../../../shared/types'
import { fetchFacilities, type Bbox } from './api'
import { distanceToPathM } from './geo'

// 경로 가까이에 있는 CCTV·안심벨·지구대 개수를 센다. 경로 응답에는 시설 정보가 없어서,
// 시설 조회 API(GET /facilities)로 경로를 감싸는 범위의 시설을 받아 프론트에서 거리를 잰다.
// 반경은 안전점수 계산과 같은 30m다 (REQUIREMENTS "안전점수 규칙")
export const NEAR_M = 30

// 서버 상한(가로·세로 각 4km, API.md 4장)보다 조금 작게 잡는다. 긴 경로는 조각으로 나눠 부른다
const TILE_M = 3900

export type FacilityCounts = Partial<Record<FacilityType, number>>

const M_PER_LAT = 110540

// 경로 전체를 감싸는 범위를 TILE_M 이하의 조각으로 나눈다
function tilesAround(paths: LatLng[][]): Bbox[] {
  const pts = paths.flat()
  if (pts.length === 0) return []
  const midLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const mPerLng = 111320 * Math.cos((midLat * Math.PI) / 180)
  // 경로 바로 옆 시설이 범위 가장자리에서 잘리지 않게 반경만큼 넓힌다
  const padLat = NEAR_M / M_PER_LAT
  const padLng = NEAR_M / mPerLng
  const minLat = Math.min(...pts.map((p) => p.lat)) - padLat
  const maxLat = Math.max(...pts.map((p) => p.lat)) + padLat
  const minLng = Math.min(...pts.map((p) => p.lng)) - padLng
  const maxLng = Math.max(...pts.map((p) => p.lng)) + padLng

  const nLat = Math.max(1, Math.ceil(((maxLat - minLat) * M_PER_LAT) / TILE_M))
  const nLng = Math.max(1, Math.ceil(((maxLng - minLng) * mPerLng) / TILE_M))
  const stepLat = (maxLat - minLat) / nLat
  const stepLng = (maxLng - minLng) / nLng
  const tiles: Bbox[] = []
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLng; j++) {
      tiles.push({
        sw: { lat: minLat + i * stepLat, lng: minLng + j * stepLng },
        ne: { lat: minLat + (i + 1) * stepLat, lng: minLng + (j + 1) * stepLng },
      })
    }
  }
  return tiles
}

// 두 경로 주변의 시설을 한 번에 받아, 경로마다 종류별 개수를 돌려준다.
// 조각의 경계에 걸친 시설은 두 번 올 수 있어 id로 거른다. 0개인 종류는 값이 없다
export async function countFacilitiesAlong(routes: Record<RouteType, Route>): Promise<Record<RouteType, FacilityCounts>> {
  const tiles = tilesAround([routes.shortest.path, routes.safe.path])
  const responses = await Promise.all(tiles.map((bbox) => fetchFacilities(bbox)))
  const all = new Map<number, Facility>()
  responses.forEach((res) => res.facilities.forEach((f) => all.set(f.id, f)))

  const count = (route: Route): FacilityCounts => {
    const counts: FacilityCounts = {}
    all.forEach((f) => {
      if (distanceToPathM(f.location, route.path) <= NEAR_M) counts[f.type] = (counts[f.type] ?? 0) + 1
    })
    return counts
  }
  return { shortest: count(routes.shortest), safe: count(routes.safe) }
}
