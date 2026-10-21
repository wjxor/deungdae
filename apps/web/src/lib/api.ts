import type {
  DaylightResponse,
  FacilitiesResponse,
  LatLng,
  PlacesResponse,
  RouteSearchRequest,
  RouteSearchResponse,
} from '../../../../shared/types'
import { mockDaylight } from '../mocks/daylight'
import { MOCK_FACILITIES } from '../mocks/facilities'
import { MOCK_PLACES } from '../mocks/places'
import { mockRouteSearch } from '../mocks/routes'

export type Bbox = { sw: LatLng; ne: LatLng }

// GET /api/daylight (API.md 1-1장). 지금은 목 데이터로 답한다. 서버가 생기면 이 함수 안만 fetch로 바꾼다.
export async function fetchDaylight(): Promise<DaylightResponse> {
  return mockDaylight()
}

// GET /api/facilities?bbox=남서lat,lng,북동lat,lng (API.md 4장). 지금은 목 데이터로 답한다.
// 서버가 생기면 이 함수 안만 fetch로 바꾼다.
export async function fetchFacilities(bbox: Bbox): Promise<FacilitiesResponse> {
  const { sw, ne } = bbox
  const facilities = MOCK_FACILITIES.filter(
    (f) => f.location.lat >= sw.lat && f.location.lat <= ne.lat && f.location.lng >= sw.lng && f.location.lng <= ne.lng,
  )
  return { facilities }
}

const MAX_PLACES = 15

const distance = (a: LatLng, b: LatLng) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2

// GET /api/places?q=&near= (API.md 2장). 지금은 목 데이터로 답한다.
// 서버가 생기면 이 함수 안만 fetch로 바꾼다. 호출하는 쪽은 그대로 둔다.
export async function searchPlaces(q: string, near?: LatLng): Promise<PlacesResponse> {
  const keyword = q.trim()
  let places = MOCK_PLACES.filter((p) => p.name.includes(keyword) || p.address.includes(keyword))
  if (near) places = [...places].sort((a, b) => distance(a.location, near) - distance(b.location, near))
  return { places: places.slice(0, MAX_PLACES) }
}

// POST /api/routes/search (API.md 3장). 지금은 목 데이터로 답한다.
// 서버가 생기면 이 함수 안만 fetch로 바꾼다. 사용자가 "경로 찾기"를 누를 때만 부른다.
export async function searchRoutes(req: RouteSearchRequest): Promise<RouteSearchResponse> {
  return mockRouteSearch(req)
}
