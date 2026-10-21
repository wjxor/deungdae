import { useEffect, useState } from 'react'
import type { FacilityType, LatLng, Mode, Place, Route, RouteSearchRequest, RouteType } from '../../../../shared/types'
import KakaoMap from '../components/KakaoMap'
import ModeToggle from '../components/ModeToggle'
import type { useDaylightMode } from '../hooks/useDaylightMode'
import { searchRoutes } from '../lib/api'
import { ROUTE_NAME, compareSentence, formatDistance, formatDuration, levelShares, pickRoute } from '../lib/routeSummary'

type Props = {
  origin: LatLng
  originLabel: string // 입력칸에 보여 줄 출발지 이름 ("현재 위치" 등)
  destination: Place
  daylight: ReturnType<typeof useDaylightMode>
  onBack: () => void
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; routes: Record<RouteType, Route>; sameRoute: boolean }
  | { status: 'failed' }

// S3 경로 비교에서는 시설 아이콘을 모두 숨긴다 (경로선과 겹쳐 지저분해서)
const NO_FACILITIES: Record<FacilityType, boolean> = { cctv: false, emergency_bell: false, police: false }

// 낮에는 최단경로, 밤에는 안심경로를 기본으로 보여 준다 (API.md 3장)
const recommendedOf = (mode: Mode): RouteType => (mode === 'night' ? 'safe' : 'shortest')

// S3 경로 비교 (FR-007). 들어올 때 경로를 한 번만 받고, 카드 선택과 낮/밤 전환은 받은 경로의 표시만 바꾼다.
export default function RouteCompare({ origin, originLabel, destination, daylight, onBack }: Props) {
  const { mode, sunrise, sunset, setMode } = daylight

  // 요청은 들어올 때 값으로 한 번만 보낸다. 이후 낮/밤을 바꿔도 다시 부르지 않는다
  const [request] = useState<RouteSearchRequest>(() => ({ origin, destination: destination.location, mode }))
  const [state, setState] = useState<State>({ status: 'loading' })
  // 사용자가 카드로 고른 경로. 없으면 낮/밤에 따른 추천을 보여 주고, 낮/밤을 바꾸면 추천으로 돌아간다
  const [picked, setPicked] = useState<RouteType | null>(null)
  const selected = picked ?? recommendedOf(mode)

  useEffect(() => {
    let cancelled = false
    searchRoutes(request)
      .then((res) => {
        const routes = { shortest: pickRoute(res, 'shortest'), safe: pickRoute(res, 'safe') }
        if (!cancelled) setState({ status: 'ready', routes, sameRoute: res.sameRoute })
      })
      .catch(() => {
        // 실패 이유별 화면은 따로 만든다 (로딩·에러 단계)
        if (!cancelled) setState({ status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [request])

  const changeMode = (next: Mode) => {
    setMode(next)
    setPicked(null)
  }

  const routes = state.status === 'ready' ? state.routes : null
  const sameRoute = state.status === 'ready' && state.sameRoute
  const sentence = routes && !sameRoute ? compareSentence(routes.shortest, routes.safe) : null

  return (
    <main className="map-home route-compare" data-mode={mode}>
      <div className="map-area">
        <KakaoMap
          center={origin}
          myLocation={null} // 출발점 표시는 경로가 오면 RouteLayer가 그린다. 위치를 못 잡아 대전시청을 쓸 때 "현재 위치" 점이 찍히지 않게 한다
          pin={destination.location}
          facilityVisible={NO_FACILITIES}
          route={routes ? { routes, selected, sameRoute, mode } : undefined}
        />

        <header className="top">
          <div className="route-head">
            <button type="button" className="back" aria-label="뒤로" onClick={onBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <span className="from">{originLabel}</span>
            <span className="arrow" aria-hidden="true">→</span>
            <strong className="to">{destination.name}</strong>
          </div>
          <div className="toprow">
            <ModeToggle mode={mode} sunrise={sunrise} sunset={sunset} onChange={changeMode} />
          </div>
        </header>
      </div>

      <section className="sheet" aria-label="경로 비교">
        {state.status === 'loading' && (
          <p className="route-status" role="status">
            경로를 찾는 중이에요
          </p>
        )}

        {state.status === 'failed' && (
          <div className="route-status" role="alert">
            <p>경로를 찾지 못했어요.</p>
            <button type="button" className="text-btn" onClick={onBack}>
              돌아가기
            </button>
          </div>
        )}

        {routes && (
          <>
            {sameRoute && (
              <p className="same" role="status">
                <b>최단경로가 곧 안심경로예요.</b>
                가장 짧고 안전점수도 가장 높은 길이에요.
              </p>
            )}

            <div className="route-cards">
              {sameRoute ? (
                <RouteCard name="최단경로 = 안심경로" route={routes.safe} selected wide onSelect={() => undefined} />
              ) : (
                (['shortest', 'safe'] as const).map((type) => (
                  <RouteCard
                    key={type}
                    name={ROUTE_NAME[type]}
                    route={routes[type]}
                    selected={selected === type}
                    onSelect={() => setPicked(type)}
                  />
                ))
              )}
            </div>

            {sentence && <p className="cmp">{sentence}</p>}

            <p className="legend" aria-label="구간 색 설명">
              <span className="safe">안전</span>
              <span className="caution">주의</span>
              <span className="danger">위험</span>
            </p>
          </>
        )}
      </section>
    </main>
  )
}

type CardProps = { name: string; route: Route; selected: boolean; wide?: boolean; onSelect: () => void }

function RouteCard({ name, route, selected, wide, onSelect }: CardProps) {
  const shares = levelShares(route)
  return (
    <button type="button" className={`route-card${wide ? ' wide' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className="name">{name}</span>
      <span className="time">{formatDuration(route.durationS)}</span>
      <span className="meta">
        {formatDistance(route.distanceM)} · 안전 {route.safetyScore}
      </span>
      <span className="mix" aria-hidden="true">
        {(['safe', 'caution', 'danger'] as const).map(
          (level) => shares[level] > 0 && <i key={level} className={level} style={{ width: `${shares[level]}%` }} />,
        )}
      </span>
    </button>
  )
}
