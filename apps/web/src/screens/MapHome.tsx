import { useState } from 'react'
import type { LatLng } from '../../../../shared/types'
import KakaoMap from '../components/KakaoMap'
import { useGeolocation } from '../hooks/useGeolocation'

// 대전시청. 현재 위치를 못 잡았을 때의 기본 중심
const DAEJEON_CENTER: LatLng = { lat: 36.3504, lng: 127.3845 }

// S1 지도 홈
export default function MapHome() {
  const geo = useGeolocation()
  const myLocation = geo.state.status === 'ready' ? geo.state.location : null
  // "내 위치" 버튼을 누르면 새 객체를 넣어, 지도를 직접 움직인 뒤에도 다시 이동하게 한다
  const [recenter, setRecenter] = useState<LatLng | null>(null)
  const center = recenter ?? myLocation ?? DAEJEON_CENTER

  const notice =
    geo.state.status === 'denied'
      ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요.'
      : geo.state.status === 'unavailable'
        ? '현재 위치를 가져오지 못했어요.'
        : null

  return (
    <main className="map-home">
      <KakaoMap center={center} myLocation={myLocation} />

      {notice && (
        <p className="notice" role="status">
          {notice}
          {geo.state.status === 'unavailable' && (
            <button type="button" onClick={geo.retry}>
              다시 시도
            </button>
          )}
        </p>
      )}

      <button
        type="button"
        className="locate"
        aria-label="내 위치로 이동"
        disabled={!myLocation}
        onClick={() => myLocation && setRecenter({ ...myLocation })}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>
    </main>
  )
}
