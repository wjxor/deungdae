import { useEffect } from 'react'
import type { LatLng, Mode, Route, RouteType, SafetyLevel } from '../../../../shared/types'
import { ROUTE_NAME, formatDuration } from '../lib/routeSummary'

export type RouteView = {
  routes: Record<RouteType, Route>
  selected: RouteType
  sameRoute: boolean // 안심경로가 최단경로와 같으면 한 경로만 그린다
  mode: Mode
}

type Props = { map: kakao.maps.Map | null; view: RouteView }

// 구간 색. 어느 구간이 안전·주의·위험인지는 서버가 level로 정해서 주고(70 이상/40~69/39 이하), 여기서는 색만 고른다.
// 밤에는 어두운 지도 위에서 보이게 밝은 색을 쓴다
const LEVEL_COLOR: Record<Mode, Record<SafetyLevel, string>> = {
  day: { safe: '#1f9d6b', caution: '#f0a22e', danger: '#e5384d' },
  night: { safe: '#35d08a', caution: '#ffc247', danger: '#ff5a6e' },
}
const OUTLINE: Record<Mode, string> = { day: '#ffffff', night: '#10151a' } // 복잡한 지도 위에서 선이 묻히지 않게 두르는 테두리
const OTHER_COLOR = '#7b838d'

const toKakao = (p: LatLng) => new kakao.maps.LatLng(p.lat, p.lng)
const toKakaoPath = (path: LatLng[]) => path.map(toKakao)

// 출발·도착 표시. 같은 핀(S1의 도착지 핀)에 이름표만 다르다. 현재 위치(my-location 링)와 모양이 달라야 해서다
function marker(text: '출발' | '도착'): HTMLElement {
  const el = document.createElement('div')
  el.className = 'route-marker'
  const tag = document.createElement('span')
  tag.className = 'route-tag'
  tag.textContent = text
  const pin = document.createElement('div')
  pin.className = 'place-pin'
  el.append(tag, pin)
  return el
}

// 지도 위에 최단·안심 경로를 그린다 (FR-007, FR-008).
// 선택한 경로는 구간 색 실선, 다른 경로는 회색 점선이고 각각 "안심경로 11분" 말풍선이 붙는다.
// 출발·도착 핀은 선택 경로의 처음·끝 점에 둔다. 목 데이터가 요청 좌표와 상관없는 경로를 주기 때문이고,
// 서버가 생기면 요청 좌표와 같아진다.
export default function RouteLayer({ map, view }: Props) {
  const { routes, selected, sameRoute, mode } = view

  // 경로가 새로 오면 전체가 보이게 지도를 맞춘다. 카드로 선택만 바꿀 때는 움직이지 않는다
  useEffect(() => {
    if (!map) return
    const bounds = new kakao.maps.LatLngBounds()
    routes.shortest.path.forEach((p) => bounds.extend(toKakao(p)))
    routes.safe.path.forEach((p) => bounds.extend(toKakao(p)))
    // 위쪽은 검색창·토글이 덮고 있어 더 넓게 비운다
    map.setBounds(bounds, 150, 48, 48, 48)
  }, [map, routes])

  useEffect(() => {
    if (!map) return
    const polylines: kakao.maps.Polyline[] = []
    const overlays: kakao.maps.CustomOverlay[] = []

    const line = (path: LatLng[], color: string, weight: number, zIndex: number, dashed = false) => {
      const p = new kakao.maps.Polyline({
        path: toKakaoPath(path),
        strokeColor: color,
        strokeWeight: weight,
        strokeOpacity: 1,
        strokeStyle: dashed ? 'dash' : 'solid',
        zIndex,
      })
      p.setMap(map)
      polylines.push(p)
    }

    const overlay = (position: LatLng, content: HTMLElement, yAnchor: number, zIndex: number) => {
      const o = new kakao.maps.CustomOverlay({ position: toKakao(position), content, xAnchor: 0.5, yAnchor, zIndex })
      o.setMap(map)
      overlays.push(o)
    }

    const bubble = (route: Route, isSelected: boolean) => {
      const el = document.createElement('div')
      el.className = `route-bubble${isSelected ? ' is-selected' : ''}`
      const time = formatDuration(route.durationS)
      el.textContent = sameRoute ? time : `${ROUTE_NAME[route.type]} ${time}`
      overlay(route.path[Math.floor(route.path.length / 2)], el, 0.5, 6)
    }

    const other: RouteType = selected === 'safe' ? 'shortest' : 'safe'
    if (!sameRoute) {
      line(routes[other].path, OUTLINE[mode], 9, 1)
      line(routes[other].path, OTHER_COLOR, 5, 2, true)
      bubble(routes[other], false)
    }

    const chosen = routes[selected]
    line(chosen.path, OUTLINE[mode], 14, 3)
    chosen.segments.forEach((s) => line(s.path, LEVEL_COLOR[mode][s.level], 8, 4))
    bubble(chosen, true)

    overlay(chosen.path[0], marker('출발'), 1, 8)
    overlay(chosen.path[chosen.path.length - 1], marker('도착'), 1, 8)

    return () => {
      polylines.forEach((p) => p.setMap(null))
      overlays.forEach((o) => o.setMap(null))
    }
  }, [map, routes, selected, sameRoute, mode])

  return null
}
