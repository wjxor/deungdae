import { useEffect, useRef, useState } from 'react'
import type { FavoritePlace, FavoriteRoute, Place } from '../../../../shared/types'
import { addFavoritePlace, addFavoriteRoute, deleteFavoritePlace, deleteFavoriteRoute, fetchFavorites } from './api'
import { ApiRequestError } from './apiError'

// 자주 가는 경로. 출발지가 null이면 "현재 위치"라서, 불러올 때 그때의 현재 위치에서 출발한다. id는 서버 행 번호
export type { FavoriteRoute }

export const routeFavoriteId = (origin: Place | null, destination: Place) => `${origin?.id ?? 'here'}>${destination.id}`

const LOAD_FAILED = '즐겨찾기를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
const SAVE_FAILED = '즐겨찾기를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const ERROR_MS = 4000

type Lists = { token: string | null; places: FavoritePlace[]; routes: FavoriteRoute[] }
const NO_PLACES: FavoritePlace[] = []
const NO_ROUTES: FavoriteRoute[] = []

// 실패 안내 문구. 서버가 준 문장(50개 초과, 로그인 만료 등)이 있으면 그것을 쓴다
const messageOf = (e: unknown, fallback: string) => (e instanceof ApiRequestError ? e.message : fallback)

// 즐겨찾기는 회원 계정에 묶여 서버에 저장된다 (API.md 5-1장, FR-012). 서버는 장소 정보를 암호화해 둔다 (NFR-004).
// 저장하는 것은 장소·출발/도착 쌍뿐이고, 점수와 경로 모양은 시설 데이터·낮밤에 따라 달라지므로 불러올 때 다시 검색한다.
// ☆를 누르면 화면을 먼저 바꾸고 서버에 보낸 뒤, 실패하면 되돌리고 error에 안내를 4초 둔다.
// 저장 응답을 기다리는 동안(임시 음수 id) 다시 눌러 끄면, 저장이 끝나는 대로 서버에서도 지운다
export function useFavorites(token: string | null) {
  // 목록이 어느 로그인(토큰)의 것인지 같이 둔다. 토큰이 바뀌면(로그아웃·다른 계정) 지난 목록은 보이지 않는다
  const [lists, setLists] = useState<Lists>({ token: null, places: [], routes: [] })
  const [error, setError] = useState<string | null>(null)
  const tempId = useRef(0)
  const cancelled = useRef(new Set<number>())

  const own = lists.token === token
  const places = own ? lists.places : NO_PLACES
  const routes = own ? lists.routes : NO_ROUTES
  const setPlaces = (update: (list: FavoritePlace[]) => FavoritePlace[]) =>
    setLists((s) => (s.token === token ? { ...s, places: update(s.places) } : { token, places: update([]), routes: [] }))
  const setRoutes = (update: (list: FavoriteRoute[]) => FavoriteRoute[]) =>
    setLists((s) => (s.token === token ? { ...s, routes: update(s.routes) } : { token, places: [], routes: update([]) }))

  // 로그인하거나 앱을 다시 열면 불러온다. 다른 토큰의 늦은 응답은 버리고, 불러오기 전에 눌러 저장 중인 것(음수 id)은 남긴다
  useEffect(() => {
    if (!token) return
    let stale = false
    fetchFavorites(token).then(
      (res) => {
        if (stale) return
        setLists((s) => {
          const pending = s.token === token ? s : { places: [], routes: [] }
          return {
            token,
            places: [...res.places, ...pending.places.filter((f) => f.id < 0)],
            routes: [...res.routes, ...pending.routes.filter((r) => r.id < 0)],
          }
        })
      },
      (e: unknown) => {
        if (!stale) setError(messageOf(e, LOAD_FAILED))
      },
    )
    return () => {
      stale = true
    }
  }, [token])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), ERROR_MS)
    return () => clearTimeout(timer)
  }, [error])

  const placeEntry = (place: Place) => places.find((f) => f.place.id === place.id)
  const routeEntry = (origin: Place | null, destination: Place) => {
    const id = routeFavoriteId(origin, destination)
    return routes.find((r) => routeFavoriteId(r.origin, r.destination) === id)
  }

  const togglePlace = (place: Place) => {
    if (!token) return
    const found = placeEntry(place)
    if (found) {
      setPlaces((list) => list.filter((f) => f.id !== found.id))
      if (found.id < 0) {
        cancelled.current.add(found.id)
        return
      }
      deleteFavoritePlace(token, found.id).catch((e: unknown) => {
        setPlaces((list) => [...list, found])
        setError(messageOf(e, SAVE_FAILED))
      })
      return
    }
    const temp = --tempId.current
    setPlaces((list) => [...list, { id: temp, place }])
    addFavoritePlace(token, place).then(
      (saved) => {
        if (cancelled.current.delete(temp)) {
          deleteFavoritePlace(token, saved.id).catch(() => undefined) // 이미 화면에서 끈 것. 실패하면 다음에 불러올 때 다시 보인다
          return
        }
        setPlaces((list) => list.map((f) => (f.id === temp ? saved : f)))
      },
      (e: unknown) => {
        cancelled.current.delete(temp)
        setPlaces((list) => list.filter((f) => f.id !== temp))
        setError(messageOf(e, SAVE_FAILED))
      },
    )
  }

  const removeRoute = (id: number) => {
    if (!token) return
    const found = routes.find((r) => r.id === id)
    if (!found) return
    setRoutes((list) => list.filter((r) => r.id !== id))
    if (id < 0) {
      cancelled.current.add(id)
      return
    }
    deleteFavoriteRoute(token, id).catch((e: unknown) => {
      setRoutes((list) => [...list, found])
      setError(messageOf(e, SAVE_FAILED))
    })
  }

  const toggleRoute = (origin: Place | null, originLabel: string, destination: Place) => {
    if (!token) return
    const found = routeEntry(origin, destination)
    if (found) {
      removeRoute(found.id)
      return
    }
    const temp = --tempId.current
    const name = `${originLabel} → ${destination.name}`
    setRoutes((list) => [...list, { id: temp, name, origin, destination }])
    addFavoriteRoute(token, { name, origin, destination }).then(
      (saved) => {
        if (cancelled.current.delete(temp)) {
          deleteFavoriteRoute(token, saved.id).catch(() => undefined)
          return
        }
        setRoutes((list) => list.map((r) => (r.id === temp ? saved : r)))
      },
      (e: unknown) => {
        cancelled.current.delete(temp)
        setRoutes((list) => list.filter((r) => r.id !== temp))
        setError(messageOf(e, SAVE_FAILED))
      },
    )
  }

  // 로그아웃·탈퇴 때 다음 사람 화면에 남지 않게 바로 비운다 (토큰이 바뀌어도 지난 목록은 보이지 않는다)
  const clear = () => {
    setLists({ token: null, places: [], routes: [] })
    setError(null)
  }

  return {
    places: places.map((f) => f.place),
    routes,
    error,
    hasPlace: (place: Place) => placeEntry(place) !== undefined,
    togglePlace,
    hasRoute: (origin: Place | null, destination: Place) => routeEntry(origin, destination) !== undefined,
    toggleRoute,
    removeRoute,
    clear,
  }
}

export type Favorites = ReturnType<typeof useFavorites>
