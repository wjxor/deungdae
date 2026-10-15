import type { LatLng, PlacesResponse } from '../../../../shared/types'
import { MOCK_PLACES } from '../mocks/places'

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
