import { useState } from 'react'
import type { FacilityType, LatLng, Place, User } from '../../../../shared/types'
import FacilityFilter from '../components/FacilityFilter'
import FavoritesSheet from '../components/FavoritesSheet'
import KakaoMap from '../components/KakaoMap'
import ModeToggle from '../components/ModeToggle'
import MyInfo from '../components/MyInfo'
import PlaceSearch from '../components/PlaceSearch'
import StarIcon from '../components/StarIcon'
import type { useDaylightMode } from '../hooks/useDaylightMode'
import type { useGeolocation } from '../hooks/useGeolocation'
import type { FavoriteRoute, Favorites } from '../lib/favorites'
import { DAEJEON_CENTER } from '../lib/geo'

type Props = {
  geo: ReturnType<typeof useGeolocation>
  daylight: ReturnType<typeof useDaylightMode>
  destination: Place | null // 검색해서 고른 도착지. 다른 화면으로 갔다 와도 App이 들고 있다
  onPickDestination: (place: Place) => void
  user: User | null // 로그인한 회원. null이면 비회원이라 [안심 경로 찾기]만 보인다
  favorites: Favorites
  onPickFavoriteRoute: (route: FavoriteRoute) => void // 즐겨찾은 경로를 고르면 출발지·도착지가 채워진 S2로 간다
  onLogout: () => void
  onDelete: () => Promise<boolean>
  onFindRoute: () => void // 도착지를 골랐을 때 [안심 경로 찾기]를 누르면 출발지를 정하는 S2로 간다
}

// S1 지도 홈
export default function MapHome({ geo, daylight, destination, onPickDestination, onFindRoute, user, favorites, onPickFavoriteRoute, onLogout, onDelete }: Props) {
  const myLocation = geo.state.status === 'ready' ? geo.state.location : null
  // 버튼이나 검색 결과로 이동할 때는 새 객체를 넣는다. 지도를 직접 움직인 뒤에도 다시 이동하게 하려는 것
  const [recenter, setRecenter] = useState<LatLng | null>(null)
  // 안심시설 종류별 표시 여부. 처음엔 모두 켠다
  const [facilityVisible, setFacilityVisible] = useState<Record<FacilityType, boolean>>({ cctv: true, emergency_bell: true, police: true })
  const toggleFacility = (type: FacilityType) => setFacilityVisible((v) => ({ ...v, [type]: !v[type] }))
  const [myInfoOpen, setMyInfoOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
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
          {user && destination && (
            <button type="button" className="favpill" aria-pressed={favorites.hasPlace(destination)} onClick={() => favorites.togglePlace(destination)}>
              <StarIcon filled={favorites.hasPlace(destination)} size={16} />
              {destination.name}
            </button>
          )}
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
          {/* 회원만: 제보·즐겨찾기·내 정보. 제보(FR-009)는 13주차라 비활성 */}
          {user && (
            <button type="button" className="report" disabled aria-label="제보하기">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l10 18H2z" />
                <path d="M12 10v5M12 18v.5" />
              </svg>
            </button>
          )}
          <button type="button" className="route" disabled={!destination} onClick={onFindRoute}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 11l18-8-8 18-2-8-8-2z" />
            </svg>
            안심 경로 찾기
          </button>
          {user && (
            <>
              <button type="button" className="report" aria-label="즐겨찾기" onClick={() => setFavoritesOpen(true)}>
                <StarIcon size={22} />
              </button>
              <button type="button" className="report" aria-label="내 정보" onClick={() => setMyInfoOpen(true)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              </button>
            </>
          )}
        </div>
      </section>

      {user && favoritesOpen && (
        <FavoritesSheet
          places={favorites.places}
          routes={favorites.routes}
          onPickPlace={(place) => {
            pick(place)
            setFavoritesOpen(false)
          }}
          onPickRoute={onPickFavoriteRoute}
          onRemovePlace={favorites.togglePlace}
          onRemoveRoute={favorites.removeRoute}
          onClose={() => setFavoritesOpen(false)}
        />
      )}
      {user && myInfoOpen && <MyInfo user={user} onLogout={onLogout} onDelete={onDelete} onClose={() => setMyInfoOpen(false)} />}
    </main>
  )
}
