import { useEffect, useRef } from 'react'
import type { FacilityType, LatLng } from '../../../../shared/types'
import { fetchFacilities } from '../lib/api'
import { createFacilityIcon } from '../lib/facilityIcon'
import { distanceM } from '../lib/geo'

// 확대했을 때만 시설을 부른다. 숫자가 작을수록 확대.
// 폰(370×858) 화면 크기를 재 보니 레벨 4는 0.7×1.7km, 레벨 5는 1.5×3.4km이고, PC 전체화면은 레벨 4가 3.8×1.9km다.
// 이 기준이면 정제 데이터 기준 한 번에 최대 약 300개가 들어온다. (초안은 레벨 4, 2km였다 — API.md 4장)
const MAX_LEVEL = 5
const BBOX_MAX_M = 4000

const TILE_M = 3500
const MAX_TILES = 30

// 넓은 화면을 4km 이하 조각으로 나눈다. 조각이 너무 많으면(MAX_TILES 초과) 부르지 않는다
function tiles(sw: LatLng, ne: LatLng): { sw: LatLng; ne: LatLng }[] {
  const latStep = TILE_M / 110574
  const lngStep = TILE_M / (111320 * Math.cos((((sw.lat + ne.lat) / 2) * Math.PI) / 180))
  const rows = Math.ceil((ne.lat - sw.lat) / latStep)
  const cols = Math.ceil((ne.lng - sw.lng) / lngStep)
  if (rows * cols > MAX_TILES) return []
  const out: { sw: LatLng; ne: LatLng }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        sw: { lat: sw.lat + r * latStep, lng: sw.lng + c * lngStep },
        ne: { lat: Math.min(sw.lat + (r + 1) * latStep, ne.lat), lng: Math.min(sw.lng + (c + 1) * lngStep, ne.lng) },
      })
    }
  }
  return out
}

type Props = {
  map: kakao.maps.Map | null
  visible: Record<FacilityType, boolean> // 종류별 표시 여부 (안심시설 필터)
  wide?: boolean // 경로 화면: 줌 레벨 제한 없이 넓은 화면도 조각으로 나눠 부른다
}

// 지도 위에 CCTV·안심벨·지구대 아이콘을 올린다 (FR-002)
export default function FacilityLayer({ map, visible, wide = false }: Props) {
  const shown = useRef(new Map<number, { type: FacilityType; overlay: kakao.maps.CustomOverlay }>())
  // load()와 필터 effect가 같은 규칙으로 보이고 숨기려고 최신 값을 ref에 둔다
  const visibleRef = useRef(visible)
  const levelOkRef = useRef(true)

  const apply = () => {
    shown.current.forEach(({ type, overlay }) => overlay.setVisible(levelOkRef.current && visibleRef.current[type]))
  }

  useEffect(() => {
    visibleRef.current = visible
    apply()
  })

  useEffect(() => {
    if (!map) return
    const layer = shown.current
    let seq = 0

    const load = async () => {
      // 아이콘 크기를 줌 레벨에 맞추려고 CSS가 읽을 수 있게 남긴다 (.map[data-level] 규칙)
      map.getNode().dataset.level = String(Math.min(map.getLevel(), 5)) // 5 이상은 모두 점
      levelOkRef.current = wide || map.getLevel() <= MAX_LEVEL
      apply()
      if (!levelOkRef.current) return

      const b = map.getBounds()
      const sw = { lat: b.getSouthWest().getLat(), lng: b.getSouthWest().getLng() }
      const ne = { lat: b.getNorthEast().getLat(), lng: b.getNorthEast().getLng() }
      const span = Math.max(distanceM(sw, { lat: sw.lat, lng: ne.lng }), distanceM(sw, { lat: ne.lat, lng: sw.lng }))
      // wide(경로 화면)는 화면이 4km보다 넓어도 4km 이하 조각으로 나눠 부른다
      const boxes = span <= BBOX_MAX_M ? [{ sw, ne }] : wide ? tiles(sw, ne) : []
      if (boxes.length === 0) return

      const mine = ++seq
      try {
        const results = await Promise.all(boxes.map((box) => fetchFacilities(box)))
        if (mine !== seq) return // 더 새 요청이 있으면 이 응답은 버린다
        results.flatMap((r) => r.facilities).forEach((f) => {
          if (layer.has(f.id)) return // 지도를 옮길 때 겹치는 시설은 id로 거른다
          const overlay = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(f.location.lat, f.location.lng),
            content: createFacilityIcon(f.type),
            xAnchor: 0.5,
            yAnchor: 0.5,
            zIndex: 5,
          })
          overlay.setMap(map)
          layer.set(f.id, { type: f.type, overlay })
        })
        apply() // 꺼 둔 종류는 새로 받아도 바로 숨긴다
      } catch {
        // 시설 아이콘만 안 보이고 지도는 계속 쓸 수 있다
      }
    }

    kakao.maps.event.addListener(map, 'idle', load)
    void load()
    return () => {
      kakao.maps.event.removeListener(map, 'idle', load)
      layer.forEach(({ overlay }) => overlay.setMap(null))
      layer.clear()
    }
  }, [map, wide])

  return null
}
