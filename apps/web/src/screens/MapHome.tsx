import { useState } from 'react'
import type { FacilityType, LatLng, Place } from '../../../../shared/types'
import FacilityFilter from '../components/FacilityFilter'
import KakaoMap from '../components/KakaoMap'
import ModeToggle from '../components/ModeToggle'
import PlaceSearch from '../components/PlaceSearch'
import type { useDaylightMode } from '../hooks/useDaylightMode'
import type { useGeolocation } from '../hooks/useGeolocation'
import { DAEJEON_CENTER } from '../lib/geo'

type Props = {
  geo: ReturnType<typeof useGeolocation>
  daylight: ReturnType<typeof useDaylightMode>
  destination: Place | null // 검색해서 고른 도착지. 다른 화면으로 갔다 와도 App이 들고 있다
  onPickDestination: (place: Place) => void
  onFindRoute: () => void // 도착지를 골랐을 때 [안심 경로 찾기]를 누르면 출발지를 정하는 S2로 간다
}

// S1 지도 홈
export default function MapHome({ geo, daylight, destination, onPickDestination, onFindRoute }: Props) {
  const myLocation = geo.state.status === 'ready' ? geo.state.location : null
  // 버튼이나 검색 결과로 이동할 때는 새 객체를 넣는다. 지도를 직접 움직인 뒤에도 다시 이동하게 하려는 것
  const [recenter, setRecenter] = useState<LatLng | null>(null)
  // 안심시설 종류별 표시 여부. 처음엔 모두 켠다
  const [facilityVisible, setFacilityVisible] = useState<Record<FacilityType, boolean>>({ cctv: true, emergency_bell: true, police: true })
  const toggleFacility = (type: FacilityType) => setFacilityVisible((v) => ({ ...v, [type]: !v[type] }))
  const pin = destination?.location ?? null
  const center = recenter ?? pin ?? myLocation ?? DAEJEON_CENTER
  const { mode, sunrise, sunset, setMode } = daylight

  const pick = (place: Place) => {
    onPickDestination(place)
    setRecenter({ ...place.location })
  }

  const notice =
    geo.state.status === 'denied'
      ? '위치 권한이 꺼져 있어요. 주소나 장소를 검색해 주세요.'
      : geo.state.status === 'unavailable'
        ? '현재 위치를 가져오지 못했어요. 주소나 장소를 검색해 주세요.'
        : null

  return (
    <main className="map-home" data-mode={mode}>
      {/* 카카오 로고와 저작권이 지도 안 아래쪽에 나오므로, 하단 시트는 지도 밖에 둔다 */}
      <div className="map-area">
        <KakaoMap center={center} myLocation={myLocation} pin={pin} facilityVisible={facilityVisible} />

        {/* 검색창은 위쪽에 둔다. 아래에 두면 폰 키보드가 입력칸과 결과 목록을 가린다 */}
        <header className="top">
          <PlaceSearch near={myLocation} onPick={pick} />
          <div className="toprow">
            <ModeToggle
              mode={mode}
              sunrise={sunrise}
              sunset={sunset}
              onChange={setMode}
            />
            <FacilityFilter visible={facilityVisible} onToggle={toggleFacility} />
          </div>
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
        </header>

        <button
          type="button"
          className="locate"
          aria-label="내 위치로 이동"
          disabled={!myLocation}
          onClick={() => myLocation && setRecenter({ ...myLocation })}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      </div>

      <section className="sheet" aria-label="경로">
        <div className="acts">
          {/* 제보(FR-009)는 Could라 13주차에 만든다 */}
          <button type="button" className="report" disabled aria-label="제보하기">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l10 18H2z" />
              <path d="M12 10v5M12 18v.5" />
            </svg>
          </button>
          <button type="button" className="route" disabled={!destination} onClick={onFindRoute}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 11l18-8-8 18-2-8-8-2z" />
            </svg>
            안심 경로 찾기
          </button>
        </div>
      </section>
    </main>
  )
}
