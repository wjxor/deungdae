import type {
  DaylightResponse,
  FacilitiesResponse,
  LatLng,
  PlacesResponse,
  RouteSearchRequest,
  RouteSearchResponse,
} from '../../../../shared/types'
import { ApiRequestError } from './apiError'

export type Bbox = { sw: LatLng; ne: LatLng }

// 서버 주소. 루트 .env의 VITE_API_BASE_URL을 쓰고, 없으면 로컬 서버
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

const CONNECTION_FAILED = '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
const UNKNOWN_FAILED = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'

// 서버를 부르고 JSON으로 돌려준다. 실패하면 서버의 { error: { code, message } }를 ApiRequestError로 던진다 (lib/apiError.ts).
// 연결이 안 되면 브라우저의 영어 메시지("Failed to fetch") 대신 한국어 문장을 쓴다.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, init)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e // 화면을 떠나며 취소한 요청은 그대로 알린다
    throw new ApiRequestError('EXTERNAL_API_ERROR', CONNECTION_FAILED)
  }

  const body: unknown = await res.json().catch(() => null)
  if (res.ok) return body as T

  const error = (body as { error?: { code?: string; message?: string } } | null)?.error
  if (error?.code && error.message) throw new ApiRequestError(error.code as ApiRequestError['code'], error.message)
  throw new ApiRequestError('EXTERNAL_API_ERROR', UNKNOWN_FAILED)
}

// GET /api/daylight (API.md 1-1장). 못 받으면 호출하는 쪽(useDaylightMode)이 낮으로 둔다.
export function fetchDaylight(): Promise<DaylightResponse> {
  return request('/daylight')
}

// GET /api/facilities?bbox=남서lat,lng,북동lat,lng (API.md 4장)
export function fetchFacilities(bbox: Bbox): Promise<FacilitiesResponse> {
  const { sw, ne } = bbox
  return request(`/facilities?bbox=${sw.lat},${sw.lng},${ne.lat},${ne.lng}`)
}

// GET /api/places?q=&near= (API.md 2장)
export function searchPlaces(q: string, near?: LatLng): Promise<PlacesResponse> {
  const params = new URLSearchParams({ q: q.trim() })
  if (near) params.set('near', `${near.lat},${near.lng}`)
  return request(`/places?${params}`)
}

// POST /api/routes/search (API.md 3장). 사용자가 "경로 찾기"를 누를 때만 부른다.
// 화면을 떠나면 요청이 취소되게 AbortSignal을 받아 넘길 수 있다.
export function searchRoutes(req: RouteSearchRequest, signal?: AbortSignal): Promise<RouteSearchResponse> {
  return request('/routes/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
}
