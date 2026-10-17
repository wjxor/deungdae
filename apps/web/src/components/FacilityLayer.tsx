import { useEffect } from 'react'
import { fetchFacilities } from '../lib/api'
import { createFacilityIcon } from '../lib/facilityIcon'
import { distanceM } from '../lib/geo'

// 확대했을 때만 시설을 부른다. 숫자가 작을수록 확대.
// 폰(370×858) 화면 크기를 재 보니 레벨 4는 0.7×1.7km, 레벨 5는 1.5×3.4km이고, PC 전체화면은 레벨 4가 3.8×1.9km다.
// 이 기준이면 정제 데이터 기준 한 번에 최대 약 300개가 들어온다. (초안은 레벨 4, 2km였다 — API.md 4장)
const MAX_LEVEL = 5
const BBOX_MAX_M = 4000

// 지도 위에 CCTV·안심벨·지구대 아이콘을 올린다 (FR-002)
export default function FacilityLayer({ map }: { map: kakao.maps.Map | null }) {
  useEffect(() => {
    if (!map) return
    const shown = new Map<number, kakao.maps.CustomOverlay>()
    let seq = 0

    const load = async () => {
      // 아이콘 크기를 줌 레벨에 맞추려고 CSS가 읽을 수 있게 남긴다 (.map[data-level] 규칙)
      map.getNode().dataset.level = String(map.getLevel())
      const visible = map.getLevel() <= MAX_LEVEL
      shown.forEach((o) => o.setVisible(visible))
      if (!visible) return

      const b = map.getBounds()
      const sw = { lat: b.getSouthWest().getLat(), lng: b.getSouthWest().getLng() }
      const ne = { lat: b.getNorthEast().getLat(), lng: b.getNorthEast().getLng() }
      const span = Math.max(distanceM(sw, { lat: sw.lat, lng: ne.lng }), distanceM(sw, { lat: ne.lat, lng: sw.lng }))
      if (span > BBOX_MAX_M) return

      const mine = ++seq
      try {
        const { facilities } = await fetchFacilities({ sw, ne })
        if (mine !== seq) return // 더 새 요청이 있으면 이 응답은 버린다
        facilities.forEach((f) => {
          if (shown.has(f.id)) return // 지도를 옮길 때 겹치는 시설은 id로 거른다
          const overlay = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(f.location.lat, f.location.lng),
            content: createFacilityIcon(f.type),
            xAnchor: 0.5,
            yAnchor: 0.5,
            zIndex: 5,
          })
          overlay.setMap(map)
          shown.set(f.id, overlay)
        })
      } catch {
        // 시설 아이콘만 안 보이고 지도는 계속 쓸 수 있다
      }
    }

    kakao.maps.event.addListener(map, 'idle', load)
    void load()
    return () => {
      kakao.maps.event.removeListener(map, 'idle', load)
      shown.forEach((o) => o.setMap(null))
    }
  }, [map])

  return null
}
