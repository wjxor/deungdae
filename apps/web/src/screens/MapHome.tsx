import { useRef, useState } from 'react'
import type { FacilityType, LatLng, Place, User } from '../../../../shared/types'
import FacilityFilter from '../components/FacilityFilter'
import FavoritesSheet from '../components/FavoritesSheet'
import InstallHint from '../components/InstallHint'
import KakaoMap from '../components/KakaoMap'
import ModeToggle from '../components/ModeToggle'
import MyInfo from '../components/MyInfo'
import PlaceSearch from '../components/PlaceSearch'
import StarIcon from '../components/StarIcon'
import type { useDaylightMode } from '../hooks/useDaylightMode'
import type { useGeolocation } from '../hooks/useGeolocation'
import type { DeleteResult } from '../lib/auth'
import type { FavoriteRoute, Favorites } from '../lib/favorites'
import { DAEJEON_CENTER, isInDaejeonRect, mapPlace } from '../lib/geo'

type Props = {
  geo: ReturnType<typeof useGeolocation>
  daylight: ReturnType<typeof useDaylightMode>
  destination: Place | null // 검색하거나 지도를 눌러 고른 도착지. 다른 화면으로 갔다 와도 App이 들고 있다
  onPickDestination: (place: Place) => void
  onClearDestination: () => void // 검색창을 비우면 도착지도 해제한다
  user: User | null // 로그인한 회원. null이면 비회원이라 [안심 경로 찾기]만 보인다
  onLogin: () => void // 비회원 하단의 [로그인]. 로그인 화면으로 간다
  favorites: Favorites
  onPickFavoriteRoute: (route: FavoriteRoute) => void // 즐겨찾은 경로를 고르면 출발지·도착지가 채워진 S2로 간다
  onLogout: () => void
  onDelete: () => Promise<DeleteResult>
  onDeleted: () => void
  accountNotice: string | null // 네이버·구글 탈퇴 확인에서 돌아온 결과 ("탈퇴했어요" 등), 탈퇴하려다 로그인 만료로 로그아웃된 안내
  authBusy: string | null // 로그인 서비스에서 돌아와 서버 응답을 기다리는 동안의 안내. 그동안 [로그인]은 막는다
  onFindRoute: () => void // 도착지를 골랐을 때 [안심 경로 찾기]를 누르면 출발지를 정하는 S2로 간다
}

// S1 지도 홈
export default function MapHome({ geo, daylight, destination, onPickDestination, onClearDestination, onFindRoute, user, onLogin, favorites, onPickFavoriteRoute, onLogout, onDelete, onDeleted, accountNotice, authBusy }: Props) {
  const myLocation = geo.state.status === 'ready' ? geo.state.location : null
  // 버튼이나 검색 결과로 이동할 때는 새 객체를 넣는다. 지도를 직접 움직인 뒤에도 다시 이동하게 하려는 것
  const [recenter, setRecenter] = useState<LatLng | null>(null)
  // 안심시설 종류별 표시 여부. 처음엔 모두 켠다
  const [facilityVisible, setFacilityVisible] = useState<Record<FacilityType, boolean>>({ cctv: true, emergency_bell: true, police: true })
  const toggleFacility = (type: FacilityType) => setFacilityVisible((v) => ({ ...v, [type]: !v[type] }))
  const [myInfoOpen, setMyInfoOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  // 즐겨찾기에서 장소를 고르면 검색창이 그 이름으로 다시 그려지게 한다 (타이핑 중에는 바꾸지 않아 입력이 끊기지 않는다)
  const [searchKey, setSearchKey] = useState(0)
  const pin = destination?.location ?? null
  const center = recenter ?? pin ?? myLocation ?? DAEJEON_CENTER
  const { mode, sunrise, sunset, setMode } = daylight

  // 대전 밖을 눌렀을 때의 안내. 다음에 도착지를 고르면 지운다
  const [outside, setOutside] = useState(false)
  const pick = (place: Place) => {
    onPickDestination(place)
    setRecenter({ ...place.location })
    setOutside(false)
  }
  // 안심시설 패널을 닫으려고 지도를 누른 것은 도착지로 치지 않는다. 닫힌 직후(0.6초 안)의 지도 누르기를 넘긴다
  const filterDismissedAt = useRef(0)
  // 지도를 누르면 그 자리가 도착지가 된다. 지도는 움직이지 않게 지금 중심에 붙잡아 두고,
  // 검색창은 새로 그려 "지도에서 고른 위치"가 들어가게 한다. 대전 밖은 서버가 OUT_OF_AREA로 막는 곳이라 핀을 찍지 않는다
  const pickOnMap = (location: LatLng, mapCenter: LatLng) => {
    if (Date.now() - filterDismissedAt.current < 600) return
    if (!isInDaejeonRect(location)) {
      setOutside(true)
      return
    }
    onPickDestination(mapPlace(location))
    setRecenter(mapCenter)
    setSearchKey((n) => n + 1)
    setOutside(false)
  }

  const notice = outside
    ? '대전 안에서만 도착지를 고를 수 있어요.'
    : geo.state.status === 'denied'
      ? '위치 권한이 꺼져 있어요. 주소나 장소를 검색해 주세요.'
      : geo.state.status === 'unavailable'
        ? '현재 위치를 가져오지 못했어요. 주소나 장소를 검색해 주세요.'
        : null

  return (
    <main className="map-home" data-mode={mode}>
      {/* 카카오 로고와 저작권이 지도 안 아래쪽에 나오므로, 하단 시트는 지도 밖에 둔다 */}
      <div className="map-area">
        <KakaoMap center={center} myLocation={myLocation} pin={pin} facilityVisible={facilityVisible} onMapClick={pickOnMap} />

        {/* 검색창은 위쪽에 둔다. 아래에 두면 폰 키보드가 입력칸과 결과 목록을 가린다 */}
        <header className="top">
          <PlaceSearch
            key={searchKey}
            near={myLocation}
            onPick={pick}
            initialQuery={destination?.name}
            onQueryChange={(text) => !text.trim() && onClearDestination()}
          />
          <div className="toprow">
            <ModeToggle
              mode={mode}
              sunrise={sunrise}
              sunset={sunset}
              onChange={setMode}
            />
            <FacilityFilter visible={facilityVisible} onToggle={toggleFacility} onDismiss={() => (filterDismissedAt.current = Date.now())} />
          </div>
          {user && destination && (
            <button type="button" className="favpill" aria-label={`${destination.name} 즐겨찾기`} aria-pressed={favorites.hasPlace(destination)} onClick={() => favorites.togglePlace(destination)}>
              <StarIcon filled={favorites.hasPlace(destination)} size={16} />
              {destination.name}
            </button>
          )}
          {(authBusy ?? accountNotice) && (
            <p className="notice" role="status">
              {authBusy ?? accountNotice}
            </p>
          )}
          {/* 도착지를 고르기 전에만 보인다. 대전 밖 안내가 뜨면 그쪽이 대신한다 */}
          {!destination && !outside && (
            <p className="map-pick-hint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
              </svg>
              지도를 눌러 도착지를 고를 수도 있어요
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
              {!outside && geo.state.status === 'unavailable' && (
                <button type="button" onClick={geo.retry}>
                  다시 시도
                </button>
              )}
            </p>
          )}
          <InstallHint />
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
          {!user && (
            <button type="button" className="login-link" disabled={!!authBusy} onClick={onLogin}>
              로그인
            </button>
          )}
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
            setSearchKey((n) => n + 1)
          }}
          onPickRoute={onPickFavoriteRoute}
          onRemovePlace={favorites.togglePlace}
          onRemoveRoute={favorites.removeRoute}
          onClose={() => setFavoritesOpen(false)}
        />
      )}
      {user && myInfoOpen && <MyInfo user={user} onLogout={onLogout} onDelete={onDelete} onDeleted={onDeleted} onClose={() => setMyInfoOpen(false)} />}
    </main>
  )
}
