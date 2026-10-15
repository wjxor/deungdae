import type { FacilitiesResponse, LatLng, PlacesResponse } from '../../../../shared/types'
import { MOCK_FACILITIES } from '../mocks/facilities'
import { MOCK_PLACES } from '../mocks/places'

export type Bbox = { sw: LatLng; ne: LatLng }

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
