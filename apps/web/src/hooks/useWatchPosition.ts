import { useEffect, useState } from 'react'
import type { LatLng } from '../../../../shared/types'

export type WatchState =
  | { status: 'loading' } // 아직 첫 위치를 못 받음
  | { status: 'ready'; location: LatLng }
  | { status: 'denied' }
  | { status: 'unavailable' }

const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator

// 켜 두는 동안 위치를 계속 받는다 (이동 중 화면). 위치 권한은 HTTPS(또는 localhost)에서만 동작한다.
// 이미 받은 위치가 있으면 잠깐 신호가 끊겨도 마지막 위치를 지우지 않는다
export function useWatchPosition(active: boolean): WatchState {
  const [state, setState] = useState<WatchState>(supported ? { status: 'loading' } : { status: 'unavailable' })

  useEffect(() => {
    if (!active || !supported) return
    const id = navigator.geolocation.watchPosition(
      (pos) => setState({ status: 'ready', location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState({ status: 'denied' })
        else setState((prev) => (prev.status === 'ready' ? prev : { status: 'unavailable' }))
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
    return () => {
      navigator.geolocation.clearWatch(id)
      setState({ status: 'loading' })
    }
  }, [active])

  return state
}
