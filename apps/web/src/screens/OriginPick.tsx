import { useState } from 'react'
import type { LatLng, Place } from '../../../../shared/types'
import KakaoMap from '../components/KakaoMap'
import PlaceSearch from '../components/PlaceSearch'
import type { useDaylightMode } from '../hooks/useDaylightMode'
import type { useGeolocation } from '../hooks/useGeolocation'
import { NO_FACILITIES } from '../lib/facilityIcon'

export type Origin = { location: LatLng; label: string }

type Props = {
  geo: ReturnType<typeof useGeolocation>
  daylight: ReturnType<typeof useDaylightMode>
  origin: Origin | null // 지금 정해진 출발지. 위치 권한도 없고 아직 검색도 안 했으면 null
  isCurrent: boolean // 출발지가 기기의 현재 위치인지
  destination: Place
  onPickOrigin: (place: Place) => void
  onUseCurrent: () => void
  onBack: () => void
  onFindRoute: () => void
}

// S2 경로 입력 (FR-003). 도착지는 S1에서 이어받고, 출발지는 현재 위치 또는 검색한 장소·주소로 정한다
export default function OriginPick({ geo, daylight, origin, isCurrent, destination, onPickOrigin, onUseCurrent, onBack, onFindRoute }: Props) {
  const myLocation = geo.state.status === 'ready' ? geo.state.location : null

  // 입력칸에 친 글자가 정해진 출발지 이름과 다르면(고르지 않고 지웠거나 새로 친 상태) 경로를 찾지 못하게 한다.
  // 출발지가 바뀌면 입력칸이 새로 그려지므로, 어느 출발지에서 친 글자인지 같이 적어 둔다
  const [edit, setEdit] = useState<{ label: string | undefined; text: string } | null>(null)
  const unfinished = edit !== null && edit.label === origin?.label && edit.text.trim() !== origin?.label
  // 출발지가 그대로여도 입력칸을 새로 그려 글자를 되돌릴 때 쓴다 ("현재 위치에서 출발")
  const [resetCount, setResetCount] = useState(0)

  // 장소를 고르면 치던 글자는 버린다. 같은 이름의 장소를 다시 골라도 입력칸이 새로 그려지지 않아서 남아 있으면 안 된다
  const pick = (place: Place) => {
    setEdit(null)
    onPickOrigin(place)
  }
  const useCurrent = () => {
    setEdit(null)
    setResetCount((n) => n + 1)
    onUseCurrent()
  }

  const notice =
    origin || geo.state.status === 'loading'
      ? null
      : geo.state.status === 'denied'
        ? '위치 권한이 꺼져 있어요. 출발지를 주소나 장소로 검색해 주세요.'
        : '현재 위치를 가져오지 못했어요. 출발지를 주소나 장소로 검색해 주세요.'

  return (
    <main className="map-home origin-pick" data-mode={daylight.mode}>
      <div className="map-area">
        <KakaoMap
          center={origin?.location ?? destination.location}
          myLocation={myLocation}
          pin={destination.location}
          originPin={isCurrent ? null : (origin?.location ?? null)}
          facilityVisible={NO_FACILITIES}
        />

        <header className="top">
          {/* 위쪽 막대는 S3와 같은 모양이고, 출발지(입력칸)와 도착지를 두 줄로 나눈다. 검색 결과는 이 막대 아래로 펼쳐진다 */}
          <div className="route-head">
            <button type="button" className="back" aria-label="뒤로" onClick={onBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="fields">
              <div className="field">
                <span className="tag from">출발</span>
                {/* 출발지가 정해지거나 바뀌면 입력칸을 새로 그려 그 이름이 들어가게 한다 */}
                <PlaceSearch
                  key={`${origin?.label ?? ''}:${resetCount}`}
                  inline
                  near={myLocation}
                  onPick={pick}
                  onQueryChange={(text) => setEdit({ label: origin?.label, text })}
                  initialQuery={origin?.label}
                  placeholder="출발지 검색"
                  ariaLabel="출발지 검색"
                />
              </div>
              <div className="field">
                <span className="tag to">도착</span>
                <strong className="to">{destination.name}</strong>
              </div>
            </div>
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
      </div>

      <section className="sheet" aria-label="경로 입력">
        {myLocation && (!isCurrent || unfinished) && (
          <button type="button" className="text-btn" onClick={useCurrent}>
            현재 위치에서 출발
          </button>
        )}
        <div className="acts">
          <button type="button" className="route" disabled={!origin || unfinished} onClick={onFindRoute}>
            경로 찾기
          </button>
        </div>
      </section>
    </main>
  )
}
