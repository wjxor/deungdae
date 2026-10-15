import { useEffect, useRef, useState } from 'react'
import type { LatLng } from '../../../../shared/types'
import { loadKakaoMaps } from '../lib/kakao'

// 대전시청. 현재 위치를 쓰기 전의 기본 중심
const DAEJEON_CENTER: LatLng = { lat: 36.3504, lng: 127.3845 }

export default function KakaoMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadKakaoMaps()
      .then((k) => {
        if (cancelled || !containerRef.current) return
        new k.maps.Map(containerRef.current, {
          center: new k.maps.LatLng(DAEJEON_CENTER.lat, DAEJEON_CENTER.lng),
          level: 4,
        })
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <div ref={containerRef} className="map" />
      {error && (
        <p className="map-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
