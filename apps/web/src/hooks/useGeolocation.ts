import { useCallback, useEffect, useState } from 'react'
import type { LatLng } from '../../../../shared/types'

export type GeoState =
  | { status: 'loading' }
  | { status: 'ready'; location: LatLng }
  | { status: 'denied' }
  | { status: 'unavailable' }

const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator

function locate(set: (s: GeoState) => void) {
  navigator.geolocation.getCurrentPosition(
    (pos) => set({ status: 'ready', location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
    (err) => set({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
    { enableHighAccuracy: true, timeout: 10000 },
  )
}

// 위치 권한은 HTTPS(또는 localhost)에서만 동작한다. 거부되면 주소 검색으로 우회해야 한다 (iOS 대응)
export function useGeolocation() {
  const [state, setState] = useState<GeoState>(supported ? { status: 'loading' } : { status: 'unavailable' })

  useEffect(() => {
    if (supported) locate(setState)
  }, [])

  const retry = useCallback(() => {
    if (!supported) return
    setState({ status: 'loading' })
    locate(setState)
  }, [])

  return { state, retry }
}
