import { useState } from 'react'
import type { Place } from '../../../../shared/types'

// 자주 가는 경로. 출발지가 null이면 "현재 위치"라서, 불러올 때 그때의 현재 위치에서 출발한다
export type FavoriteRoute = {
  id: string
  name: string
  origin: Place | null
  destination: Place
}

export const routeFavoriteId = (origin: Place | null, destination: Place) => `${origin?.id ?? 'here'}>${destination.id}`

// 즐겨찾기 저장은 회원 계정에 묶여 서버(상협)가 맡는다 (FR-012, API 미정).
// 서버가 붙기 전에는 이 앱을 켜 둔 동안만 메모리에 둔다. 저장하는 것은 장소·출발/도착 쌍뿐이고,
// 점수와 경로 모양은 시설 데이터·낮밤에 따라 달라지므로 불러올 때 다시 검색한다.
export function useFavorites() {
  const [places, setPlaces] = useState<Place[]>([])
  const [routes, setRoutes] = useState<FavoriteRoute[]>([])

  const hasPlace = (place: Place) => places.some((p) => p.id === place.id)
  const togglePlace = (place: Place) =>
    setPlaces((list) => (list.some((p) => p.id === place.id) ? list.filter((p) => p.id !== place.id) : [...list, place]))

  const hasRoute = (origin: Place | null, destination: Place) => routes.some((r) => r.id === routeFavoriteId(origin, destination))
  const toggleRoute = (origin: Place | null, originLabel: string, destination: Place) => {
    const id = routeFavoriteId(origin, destination)
    setRoutes((list) =>
      list.some((r) => r.id === id) ? list.filter((r) => r.id !== id) : [...list, { id, name: `${originLabel} → ${destination.name}`, origin, destination }],
    )
  }
  const removeRoute = (id: string) => setRoutes((list) => list.filter((r) => r.id !== id))

  const clear = () => {
    setPlaces([])
    setRoutes([])
  }

  return { places, routes, hasPlace, togglePlace, hasRoute, toggleRoute, removeRoute, clear }
}

export type Favorites = ReturnType<typeof useFavorites>
