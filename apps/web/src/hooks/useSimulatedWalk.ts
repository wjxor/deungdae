import { useEffect, useState } from 'react'
import type { LatLng } from '../../../../shared/types'
import type { WatchState } from './useWatchPosition'

// 개발 서버에서 주소 끝에 ?walk 를 붙이면 안내 시작 때 실제 위치 대신 이 가짜 걸음을 쓴다 (PC에서 이동 중 화면 확인용).
// 배포 빌드에서는 import.meta.env.DEV가 false라 늘 꺼져 있다. ?walk=20처럼 숫자를 주면 초당 그 m씩 간다
export const WALK_SPEED_MPS = import.meta.env.DEV && typeof location !== 'undefined' ? walkSpeed(location.search) : 0

function walkSpeed(search: string): number {
  const v = new URLSearchParams(search).get('walk')
  if (v === null) return 0
  const n = Number(v)
  return n > 0 ? n : 8
}

const TICK_MS = 1000
const M_PER_LAT = 110540

// 경로를 따라 meters만큼 간 지점. 끝을 넘으면 끝점
function pointAt(path: LatLng[], meters: number): LatLng {
  let left = meters
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const mPerLng = 111320 * Math.cos((a.lat * Math.PI) / 180)
    const len = Math.hypot((b.lng - a.lng) * mPerLng, (b.lat - a.lat) * M_PER_LAT)
    if (left <= len && len > 0) {
      const t = left / len
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
    }
    left -= len
  }
  return path[path.length - 1]
}

export function useSimulatedWalk(active: boolean, path: LatLng[] | null): WatchState {
  const [state, setState] = useState<WatchState>({ status: 'loading' })

  useEffect(() => {
    if (!active || !path || path.length === 0 || WALK_SPEED_MPS === 0) return
    let walked = 0
    const step = () => {
      setState({ status: 'ready', location: pointAt(path, walked) })
      walked += WALK_SPEED_MPS * (TICK_MS / 1000)
    }
    step()
    const id = window.setInterval(step, TICK_MS)
    return () => {
      window.clearInterval(id)
      setState({ status: 'loading' })
    }
  }, [active, path])

  return state
}
