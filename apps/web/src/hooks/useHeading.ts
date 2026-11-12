import { useState } from 'react'
import type { LatLng } from '../../../../shared/types'
import { distanceM } from '../lib/geo'

const MIN_MOVE_M = 3 // 이만큼 움직여야 방향을 새로 계산한다 (GPS 흔들림에 화살표가 돌지 않게)

// a에서 b로 가는 방향. 북쪽이 0도이고 시계 방향으로 커진다
function bearing(a: LatLng, b: LatLng): number {
  const dLat = b.lat - a.lat
  const dLng = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180)
  return ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360
}

// 위치가 바뀐 방향으로 진행 방향을 구한다. 아직 움직이지 않았거나 위치가 없으면 null.
// 브라우저의 heading 값은 멈춰 있으면 비고 PC에서는 없어서, 실제 위치와 ?walk 시뮬레이션이 같은 계산을 쓰도록 이동한 방향으로 구한다
export function useHeading(location: LatLng | null): number | null {
  const [track, setTrack] = useState<{ last: LatLng | null; heading: number | null }>({ last: null, heading: null })

  // 렌더 중에 값을 맞춘다 (위치가 바뀔 때마다 effect로 상태를 또 바꾸지 않으려고)
  if (location === null) {
    if (track.last !== null) setTrack({ last: null, heading: null })
  } else if (track.last === null) {
    setTrack({ last: location, heading: null })
  } else if (track.last !== location && distanceM(track.last, location) >= MIN_MOVE_M) {
    setTrack({ last: location, heading: bearing(track.last, location) })
  }

  return track.heading
}
