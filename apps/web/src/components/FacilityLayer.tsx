import { useEffect, useRef } from 'react'
import type { Facility, FacilityType, LatLng } from '../../../../shared/types'
import { fetchFacilities, type Bbox } from '../lib/api'
import { createFacilityIcon } from '../lib/facilityIcon'
import { DAEJEON_CENTER, DAEJEON_RECT, distanceM } from '../lib/geo'

// 확대했을 때만 시설을 부른다. 숫자가 작을수록 확대.
// 폰(370×858) 화면 크기를 재 보니 레벨 4는 0.7×1.7km, 레벨 5는 1.5×3.4km이고, PC 전체화면은 레벨 4가 3.8×1.9km다.
// 이 기준이면 정제 데이터 기준 한 번에 최대 약 300개가 들어온다. (초안은 레벨 4, 2km였다 — API.md 4장)
const MAX_LEVEL = 5
const BBOX_MAX_M = 4000

// 경로 화면(wide)은 대전을 고정 격자로 나눠 칸마다 한 번만 부른다. 한 칸은 서버 상한(4km)보다 작게 잡는다.
// 대전 사각형이 11×9칸이라, 끝까지 축소해도 부를 칸 수가 정해져 있다
const CELL_M = 3500
const CELL_LAT = CELL_M / 110574
const CELL_LNG = CELL_M / (111320 * Math.cos((DAEJEON_CENTER.lat * Math.PI) / 180))
const ROWS = Math.ceil((DAEJEON_RECT.maxLat - DAEJEON_RECT.minLat) / CELL_LAT)
const COLS = Math.ceil((DAEJEON_RECT.maxLng - DAEJEON_RECT.minLng) / CELL_LNG)
const PARALLEL = 6 // 한꺼번에 보내는 요청 수

type Cell = { key: string; box: Bbox }

// 화면과 겹치는 격자 칸. 화면 가운데에 가까운 칸부터 부르려고 거리순으로 둔다. 대전 밖 화면이면 빈 목록
function cellsIn(sw: LatLng, ne: LatLng): Cell[] {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))
  if (ne.lat < DAEJEON_RECT.minLat || sw.lat > DAEJEON_RECT.maxLat || ne.lng < DAEJEON_RECT.minLng || sw.lng > DAEJEON_RECT.maxLng) return []
  const r0 = clamp(Math.floor((sw.lat - DAEJEON_RECT.minLat) / CELL_LAT), ROWS - 1)
  const r1 = clamp(Math.floor((ne.lat - DAEJEON_RECT.minLat) / CELL_LAT), ROWS - 1)
  const c0 = clamp(Math.floor((sw.lng - DAEJEON_RECT.minLng) / CELL_LNG), COLS - 1)
  const c1 = clamp(Math.floor((ne.lng - DAEJEON_RECT.minLng) / CELL_LNG), COLS - 1)
  const center = { lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 }
  const out: (Cell & { d: number })[] = []
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cellSw = { lat: DAEJEON_RECT.minLat + r * CELL_LAT, lng: DAEJEON_RECT.minLng + c * CELL_LNG }
      const cellNe = { lat: cellSw.lat + CELL_LAT, lng: cellSw.lng + CELL_LNG }
      const mid = { lat: cellSw.lat + CELL_LAT / 2, lng: cellSw.lng + CELL_LNG / 2 }
      out.push({ key: `${r},${c}`, box: { sw: cellSw, ne: cellNe }, d: distanceM(center, mid) })
    }
  }
  return out.sort((a, b) => a.d - b.d)
}

// items를 limit개씩 동시에 처리한다
async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

type Props = {
  map: kakao.maps.Map | null
  visible: Record<FacilityType, boolean> // 종류별 표시 여부 (안심시설 필터)
  wide?: boolean // 경로 화면: 줌 레벨 제한 없이 넓은 화면도 격자 칸으로 나눠 부른다
}

// 지도 위에 CCTV·안심벨·지구대 아이콘을 올린다 (FR-002)
export default function FacilityLayer({ map, visible, wide = false }: Props) {
  // 받은 시설은 데이터로 두고, 오버레이는 보이는 종류만 만든다 (경로 화면은 CCTV를 받아도 오버레이를 만들지 않는다)
  const facilities = useRef(new Map<number, Facility>())
  const overlays = useRef(new Map<number, kakao.maps.CustomOverlay>())
  // load()와 필터 effect가 같은 규칙으로 보이고 숨기려고 최신 값을 ref에 둔다
  const visibleRef = useRef(visible)
  const levelOkRef = useRef(true)

  const apply = (map: kakao.maps.Map) => {
    facilities.current.forEach((f) => {
      const show = levelOkRef.current && visibleRef.current[f.type]
      let overlay = overlays.current.get(f.id)
      if (!overlay) {
        if (!show) return
        overlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(f.location.lat, f.location.lng),
          content: createFacilityIcon(f.type),
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 5,
        })
        overlay.setMap(map)
        overlays.current.set(f.id, overlay)
      }
      overlay.setVisible(show)
    })
  }

  useEffect(() => {
    visibleRef.current = visible
    if (map) apply(map)
  })

  useEffect(() => {
    if (!map) return
    const data = facilities.current
    const layer = overlays.current
    const requested = new Set<string>() // 경로 화면에서 이미 불렀거나 부르는 중인 칸
    let seq = 0
    let disposed = false

    // 지도를 옮길 때 겹치는 시설은 id가 같아 한 번만 남는다
    const add = (list: Facility[]) => {
      list.forEach((f) => data.set(f.id, f))
      apply(map) // 꺼 둔 종류는 오버레이를 만들지 않는다
    }

    const load = async () => {
      // 아이콘 크기를 줌 레벨에 맞추려고 CSS가 읽을 수 있게 남긴다 (.map[data-level] 규칙)
      map.getNode().dataset.level = String(Math.min(map.getLevel(), 5)) // 5 이상은 모두 점
      levelOkRef.current = wide || map.getLevel() <= MAX_LEVEL
      apply(map)
      if (!levelOkRef.current) return

      const b = map.getBounds()
      const sw = { lat: b.getSouthWest().getLat(), lng: b.getSouthWest().getLng() }
      const ne = { lat: b.getNorthEast().getLat(), lng: b.getNorthEast().getLng() }

      if (wide) {
        // 받은 칸은 다시 부르지 않아서, 축소하면 새로 보이는 칸만 부른다
        const todo = cellsIn(sw, ne).filter((cell) => !requested.has(cell.key))
        todo.forEach((cell) => requested.add(cell.key))
        await runLimited(todo, PARALLEL, async (cell) => {
          try {
            const res = await fetchFacilities(cell.box)
            if (!disposed) add(res.facilities)
          } catch {
            requested.delete(cell.key) // 시설 아이콘만 빠지고, 지도를 다시 움직이면 그 칸을 또 부른다
          }
        })
        return
      }

      const span = Math.max(distanceM(sw, { lat: sw.lat, lng: ne.lng }), distanceM(sw, { lat: ne.lat, lng: sw.lng }))
      if (span > BBOX_MAX_M) return
      const mine = ++seq
      try {
        const res = await fetchFacilities({ sw, ne })
        if (mine !== seq || disposed) return // 더 새 요청이 있으면 이 응답은 버린다
        add(res.facilities)
      } catch {
        // 시설 아이콘만 안 보이고 지도는 계속 쓸 수 있다
      }
    }

    kakao.maps.event.addListener(map, 'idle', load)
    void load()
    return () => {
      disposed = true
      kakao.maps.event.removeListener(map, 'idle', load)
      layer.forEach((overlay) => overlay.setMap(null))
      layer.clear()
      data.clear()
    }
  }, [map, wide])

  return null
}
