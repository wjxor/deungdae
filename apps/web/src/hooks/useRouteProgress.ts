import { useState } from 'react'
import type { LatLng } from '../../../../shared/types'
import { distanceM } from '../lib/geo'
import { routeProgress } from '../lib/progress'

export const OFF_ROUTE_M = 50 // 경로에서 이만큼 떨어지면 벗어났다고 알린다 (GPS 흔들림보다 크게)
const ARRIVE_M = 30 // 도착지에서 이만큼 안이면 도착으로 본다
const BACK_M = 30 // 지금까지 온 곳보다 이만큼 뒤까지 찾는다 (GPS가 조금 뒤로 튀어도 잡히게)
const AHEAD_M = 100 // 지금까지 온 곳보다 이만큼 앞까지 찾는다 (위치는 1초마다 오고 ?walk=30도 한 번에 30m)
const CATCH_UP_M = 20 // 근처에서 못 찾았는데 경로 다른 곳에 이만큼 가까우면 거기까지 간 것으로 본다 (GPS가 한동안 끊겼다 잡힌 경우)

export type NavProgress = {
  alongM: number // 경로 시작부터 지금까지 가장 멀리 온 길이(m). 줄지 않는다
  totalM: number
  offRouteM: number // 경로 전체에서 가장 가까운 곳까지의 거리(m)
  arrived: boolean // 한 번 도착하면 GPS가 30m 밖으로 튀어도 유지한다
}

type Track = { farthestM: number; arrived: boolean }

// 새 위치 하나를 받아 진행 상황을 한 걸음 갱신한다. 상태 없이 계산만 해서 따로 확인할 수 있다
export function advance(track: Track, location: LatLng, path: LatLng[]): NavProgress {
  const near = routeProgress(location, path, { fromM: track.farthestM - BACK_M, toM: track.farthestM + AHEAD_M })
  const whole = routeProgress(location, path)
  let along = track.farthestM
  if (near.offRouteM <= OFF_ROUTE_M) along = near.alongM
  else if (whole.offRouteM <= CATCH_UP_M) along = whole.alongM

  return {
    alongM: Math.max(track.farthestM, along),
    totalM: whole.totalM,
    offRouteM: whole.offRouteM,
    arrived: track.arrived || distanceM(location, path[path.length - 1]) <= ARRIVE_M,
  }
}

// 이동 중 진행 상황. 경로 전체에서 가장 가까운 점을 쓰면 되돌아오는 경로에서 안 간 뒤쪽 길에 잡혀
// 지나온 길이 앞으로 튀어서, 지금까지 온 곳 근처(BACK_M ~ AHEAD_M)에서 먼저 찾는다 (PR #65 리뷰).
// location이 null이면(안내를 끝냄) 처음으로 돌린다
export function useRouteProgress(location: LatLng | null, path: LatLng[] | null): NavProgress | null {
  const [track, setTrack] = useState<Track>({ farthestM: 0, arrived: false })

  if (!location || !path || path.length < 2) {
    if (track.farthestM !== 0 || track.arrived) setTrack({ farthestM: 0, arrived: false })
    return null
  }

  const next = advance(track, location, path)
  // 렌더 중에 값을 맞춘다 (위치가 바뀔 때마다 effect로 상태를 또 바꾸지 않으려고)
  if (next.alongM !== track.farthestM || next.arrived !== track.arrived) setTrack({ farthestM: next.alongM, arrived: next.arrived })
  return next
}
