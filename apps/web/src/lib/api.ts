import type {
  AddFavoritePlaceRequest,
  AddFavoriteRouteRequest,
  AuthResponse,
  DaylightResponse,
  FacilitiesResponse,
  FavoritePlace,
  FavoritePlaceResponse,
  FavoriteRoute,
  FavoriteRouteResponse,
  FavoritesResponse,
  KakaoLoginRequest,
  LatLng,
  MeResponse,
  Place,
  PlacesResponse,
  RouteSearchRequest,
  RouteSearchResponse,
  SocialLoginRequest,
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

// POST /api/auth/kakao (API.md 5장). 카카오에서 받은 인가 코드와 그때 쓴 redirectUri를 넘기고 로그인 토큰을 받는다
export function loginWithKakao(req: KakaoLoginRequest): Promise<AuthResponse> {
  return request('/auth/kakao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

// POST /api/auth/naver·/api/auth/google (API.md 5장). 서비스에서 받은 인가 코드·redirectUri·state를 넘기고 로그인 토큰을 받는다
export function loginWithSocial(provider: 'naver' | 'google', req: SocialLoginRequest): Promise<AuthResponse> {
  return request(`/auth/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

// GET /api/auth/me (API.md 5장). 저장해 둔 토큰이 아직 쓸 수 있는지 확인한다
export function fetchMe(token: string): Promise<MeResponse> {
  return request('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
}

// DELETE /api/auth/me (API.md 5장). 탈퇴 — 응답은 204라 본문이 없다 (request는 빈 본문을 null로 넘긴다).
// 네이버·구글 회원은 한 번 더 로그인해 받은 코드(reauth)를 본문으로 보낸다. 카카오 회원은 본문이 없다
export async function deleteMe(token: string, reauth?: SocialLoginRequest): Promise<void> {
  await request<null>('/auth/me', {
    method: 'DELETE',
    headers: reauth ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${token}` },
    body: reauth ? JSON.stringify(reauth) : undefined,
  })
}

// 즐겨찾기 (API.md 5-1장, FR-012). 모두 로그인 토큰이 필요하다
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const bearerJson = (token: string) => ({ ...bearer(token), 'Content-Type': 'application/json' })

// GET /api/favorites — 장소·경로를 저장한 순서로
export function fetchFavorites(token: string): Promise<FavoritesResponse> {
  return request('/favorites', { headers: bearer(token) })
}

// POST /api/favorites/places — 이미 저장한 곳이면 서버가 그 행을 돌려준다
export async function addFavoritePlace(token: string, place: Place): Promise<FavoritePlace> {
  const body: AddFavoritePlaceRequest = { place }
  const res = await request<FavoritePlaceResponse>('/favorites/places', { method: 'POST', headers: bearerJson(token), body: JSON.stringify(body) })
  return res.place
}

// DELETE /api/favorites/places/:id — 204라 본문이 없다
export async function deleteFavoritePlace(token: string, id: number): Promise<void> {
  await request<null>(`/favorites/places/${id}`, { method: 'DELETE', headers: bearer(token) })
}

// POST /api/favorites/routes — 출발지·도착지만 저장한다 (origin null = 현재 위치)
export async function addFavoriteRoute(token: string, req: AddFavoriteRouteRequest): Promise<FavoriteRoute> {
  const res = await request<FavoriteRouteResponse>('/favorites/routes', { method: 'POST', headers: bearerJson(token), body: JSON.stringify(req) })
  return res.route
}

// DELETE /api/favorites/routes/:id
export async function deleteFavoriteRoute(token: string, id: number): Promise<void> {
  await request<null>(`/favorites/routes/${id}`, { method: 'DELETE', headers: bearer(token) })
}
