import { useEffect, useState } from 'react'
import type { LatLng, Mode, Place, Route, RouteSearchRequest, RouteType } from '../../../../shared/types'
import KakaoMap from '../components/KakaoMap'
import ModeToggle from '../components/ModeToggle'
import StarIcon from '../components/StarIcon'
import RouteSheet from '../components/RouteSheet'
import type { useDaylightMode } from '../hooks/useDaylightMode'
import { searchRoutes } from '../lib/api'
import { ApiRequestError } from '../lib/apiError'
import { NO_FACILITIES } from '../lib/facilityIcon'
import { pickRoute } from '../lib/routeSummary'

type Props = {
  origin: LatLng
  originLabel: string // 입력칸에 보여 줄 출발지 이름 ("현재 위치" 등)
  myLocation: LatLng | null // 기기가 알려 준 현재 위치. 출발지와 다를 수 있다
  destination: Place
  daylight: ReturnType<typeof useDaylightMode>
  favorite?: { on: boolean; onToggle: () => void } // 회원만. 이 경로(출발지→도착지)를 자주 가는 경로로 담는다
  onBack: () => void
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; routes: Record<RouteType, Route>; sameRoute: boolean }
  | { status: 'failed'; message: string }

// 낮에는 최단경로, 밤에는 안심경로를 기본으로 보여 준다 (API.md 3장)
const recommendedOf = (mode: Mode): RouteType => (mode === 'night' ? 'safe' : 'shortest')

// 이 시간이 지나도 응답이 없으면 취소할 수 있게 알려 준다 (NFR-001 응답 3초)
const SLOW_MS = 3000

const FALLBACK_MESSAGE = '경로를 찾지 못했어요. 잠시 후 다시 시도해 주세요.'

// S3 경로 비교 (FR-007). 들어올 때 경로를 한 번만 받고, 경로 선택과 낮/밤 전환은 받은 경로의 표시만 바꾼다.
export default function RouteCompare({ origin, originLabel, myLocation, destination, daylight, favorite, onBack }: Props) {
  const { mode, sunrise, sunset, setMode } = daylight

  // 요청은 들어올 때 값으로 한 번만 보낸다. 이후 낮/밤을 바꿔도 다시 부르지 않는다
  const [request] = useState<RouteSearchRequest>(() => ({ origin, destination: destination.location, mode }))
  const [state, setState] = useState<State>({ status: 'loading' })
  const [slow, setSlow] = useState(false)
  // 사용자가 시트에서 고른 경로. 없으면 낮/밤에 따른 추천을 보여 주고, 낮/밤을 바꾸면 추천으로 돌아간다
  const [picked, setPicked] = useState<RouteType | null>(null)
  const selected = picked ?? recommendedOf(mode)

  useEffect(() => {
    // 화면을 떠나면(뒤로·취소) 늦게 온 응답은 버린다
    let cancelled = false
    searchRoutes(request)
      .then((res) => {
        const routes = { shortest: pickRoute(res, 'shortest'), safe: pickRoute(res, 'safe') }
        if (!cancelled) setState({ status: 'ready', routes, sameRoute: res.sameRoute })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'failed', message: e instanceof ApiRequestError ? e.message : FALLBACK_MESSAGE })
      })
    return () => {
      cancelled = true
    }
  }, [request])

  useEffect(() => {
    if (state.status !== 'loading') return
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(timer)
  }, [state.status])

  const changeMode = (next: Mode) => {
    setMode(next)
    setPicked(null)
  }

  const routes = state.status === 'ready' ? state.routes : null
  const sameRoute = state.status === 'ready' && state.sameRoute

  return (
    <main className="map-home route-compare" data-mode={mode}>
      <div className="map-area">
        <KakaoMap
          center={origin}
          myLocation={myLocation}
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
            {favorite && (
              <button type="button" className="star" aria-pressed={favorite.on} aria-label="자주 가는 경로로 즐겨찾기" onClick={favorite.onToggle}>
                <StarIcon filled={favorite.on} />
              </button>
            )}
          </div>
          <div className="toprow">
            <ModeToggle mode={mode} sunrise={sunrise} sunset={sunset} onChange={changeMode} />
          </div>
        </header>
      </div>

      {routes ? (
        <RouteSheet routes={routes} selected={selected} sameRoute={sameRoute} onSelect={setPicked} />
      ) : (
        <section className="sheet" aria-label="경로 비교">
          {state.status === 'loading' && (
            <>
              <div className="route-cards" aria-hidden="true">
                <div className="route-skel" />
                <div className="route-skel" />
              </div>
              <p className="route-status" role="status">
                {slow ? '조금 오래 걸리고 있어요. ' : '경로를 찾는 중이에요'}
                {slow && (
                  <button type="button" className="text-btn" onClick={onBack}>
                    취소
                  </button>
                )}
              </p>
            </>
          )}

          {state.status === 'failed' && (
            // 서버가 준 문장을 그대로 보여 준다. 돌아가면 S2에서 출발지를 바꿀 수 있다
            <div className="route-status" role="alert">
              <p>{state.message}</p>
              <button type="button" className="text-btn" onClick={onBack}>
                돌아가기
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
