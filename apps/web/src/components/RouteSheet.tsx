import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { FacilityType, Route, RouteType } from '../../../../shared/types'
import { FACILITY_TYPES } from '../lib/facilityIcon'
import { NEAR_M, countFacilitiesAlong, type FacilityCounts } from '../lib/routeFacilities'
import {
  LEVEL_LABEL,
  LEVEL_ORDER,
  ROUTE_NAME,
  compareSentence,
  formatDistance,
  formatDuration,
  levelMeters,
  levelRuns,
  levelShares,
  routeDiff,
  signedDistance,
  signedDuration,
  signedScore,
} from '../lib/routeSummary'

type Props = {
  routes: Record<RouteType, Route>
  selected: RouteType
  sameRoute: boolean // 안심경로가 최단경로와 같으면 비교할 것이 없다
  onSelect: (type: RouteType) => void
}

// 시트의 세 단계. 접힘은 지도를 가장 많이 남기고, 펼침은 자세한 구성까지 보여 준다
type Snap = 'peek' | 'half' | 'full'

const ORDER: Snap[] = ['peek', 'half', 'full']
const DRAG_PX = 40 // 이만큼 끌면 한 단계 움직인다
const TAP_PX = 8 // 이보다 덜 움직이면 누른 것으로 본다

const TYPES: RouteType[] = ['shortest', 'safe']

// 경로 주변 시설 이름과 세는 단위. 지구대 데이터에는 파출소도 들어 있다
const FACILITY_LABEL: Record<FacilityType, { name: string; unit: string }> = {
  cctv: { name: 'CCTV', unit: '대' },
  emergency_bell: { name: '안심벨', unit: '개' },
  police: { name: '지구대·파출소', unit: '곳' },
}

// 구간 색 띠. 길이는 경로 거리에 비례하고, 색은 안전도가 바뀌는 곳에서만 나뉜다 (FR-008)
function Ribbon({ route, longest, large = false }: { route: Route; longest: number; large?: boolean }) {
  return (
    <span className={`rs-ribbon${large ? ' large' : ''}`} style={{ width: `${(route.distanceM / longest) * 100}%` }} aria-hidden="true">
      {levelRuns(route).map((run, i) => (
        <i key={i} className={run.level} style={{ flex: run.meters }} />
      ))}
    </span>
  )
}

// 안전·주의·위험 거리 구성. 띠로는 비율만 보이니 거리와 퍼센트를 글자로 함께 적는다
function LevelTable({ route }: { route: Route }) {
  const meters = levelMeters(route)
  const shares = levelShares(route)
  return (
    <div className="rs-lvt">
      {LEVEL_ORDER.map((level) => (
        <div key={level}>
          <span>{LEVEL_LABEL[level]}</span>
          <span className="bar" aria-hidden="true">
            <i className={level} style={{ width: `${shares[level]}%` }} />
          </span>
          <span className="v">
            <b>{formatDistance(meters[level])}</b> {shares[level]}%
          </span>
        </div>
      ))}
    </div>
  )
}

// S3 경로 비교 바텀시트 (FR-007). 접힘·중간·펼침 세 단계이고, 손잡이를 끌거나 누르면 단계가 바뀐다.
// 시트 높이가 바뀌면 지도 크기도 바뀌므로, RouteLayer가 크기 변화를 보고 경로를 다시 맞춘다.
export default function RouteSheet({ routes, selected, sameRoute, onSelect }: Props) {
  const [snap, setSnap] = useState<Snap>('half')
  const [dy, setDy] = useState(0) // 끄는 동안 시트가 손가락을 따라가는 거리
  const startY = useRef<number | null>(null)
  // 경로 주변 시설 개수. 펼쳤을 때 처음 한 번만 부른다
  const [counts, setCounts] = useState<Record<RouteType, FacilityCounts> | null>(null)
  const fetchedFor = useRef<typeof routes | null>(null)

  const route = routes[sameRoute ? 'safe' : selected] // 같은 경로면 어느 쪽이든 내용이 같다
  const longest = Math.max(routes.shortest.distanceM, routes.safe.distanceM)
  const sentence = sameRoute ? null : compareSentence(routes.shortest, routes.safe)
  const diff = routeDiff(routes.shortest, routes.safe)
  const index = ORDER.indexOf(snap)

  useEffect(() => {
    if (snap !== 'full' || fetchedFor.current === routes) return
    fetchedFor.current = routes
    countFacilitiesAlong(routes)
      .then((c) => {
        if (fetchedFor.current === routes) setCounts(c)
      })
      .catch(() => {
        // 시설 개수는 덧붙이는 정보라 못 받으면 말하지 않는다. 다시 펼치면 한 번 더 시도한다
        if (fetchedFor.current === routes) fetchedFor.current = null
      })
  }, [snap, routes])
  const near = counts?.[sameRoute ? 'safe' : selected]
  const nearTypes = near ? FACILITY_TYPES.filter((type) => (near[type] ?? 0) > 0) : []

  const cycle = () => setSnap(ORDER[(index + 1) % ORDER.length])
  const step = (delta: number) => setSnap(ORDER[Math.min(ORDER.length - 1, Math.max(0, index + delta))])

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    startY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (startY.current === null) return
    // 지도 쪽으로 너무 멀리 끌려 올라가지 않게 위쪽은 짧게 막는다
    setDy(Math.max(-DRAG_PX, e.clientY - startY.current))
  }
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (startY.current === null) return
    const moved = e.clientY - startY.current
    startY.current = null
    setDy(0)
    if (Math.abs(moved) < TAP_PX) cycle()
    else if (moved <= -DRAG_PX) step(1)
    else if (moved >= DRAG_PX) step(-1)
  }
  const onPointerCancel = () => {
    startY.current = null
    setDy(0)
  }
  // 키보드로는 누르는 것과 같이 한 단계씩 돌린다. 포인터 입력은 위에서 따로 처리해서 click은 쓰지 않는다
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    cycle()
  }

  const rowButton = (type: RouteType) => {
    const r = routes[type]
    return (
      <button key={type} type="button" className="rs-row" role="radio" aria-checked={selected === type} onClick={() => onSelect(type)}>
        <i className="rd" aria-hidden="true" />
        <span className="nm">{ROUTE_NAME[type]}</span>
        <span className="tm">{formatDuration(r.durationS)}</span>
        <span className="sc" data-level={r.level}>
          {r.safetyScore}
        </span>
        <span className="mt">{formatDistance(r.distanceM)}</span>
        <Ribbon route={r} longest={longest} />
      </button>
    )
  }

  // 행의 시간·점수 열 위에 붙는 머리글. 같은 경로일 때는 선택 표시 열이 없다
  const colHead = (isStatic: boolean) => (
    <div className={`rs-colh${isStatic ? ' static' : ''}`} aria-hidden="true">
      {!isStatic && <span />}
      <span />
      <span>소요 시간</span>
      <span>안전점수</span>
    </div>
  )

  const legend = (
    <p className="legend">
      {LEVEL_ORDER.map((level) => (
        <span key={level} className={level}>
          {LEVEL_LABEL[level]}
        </span>
      ))}
    </p>
  )

  return (
    <section
      className="sheet rs"
      data-snap={snap}
      aria-label="경로 비교"
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
    >
      <button
        type="button"
        className="rs-grab"
        aria-expanded={snap !== 'peek'}
        aria-label={snap === 'full' ? '경로 정보 접기' : '경로 정보 펼치기'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <i />
      </button>

      {snap === 'peek' && (
        <>
          {sameRoute ? (
            <p className="rs-title">최단경로 = 안심경로</p>
          ) : (
            <div className="rs-tabs" role="tablist" aria-label="경로 선택">
              {TYPES.map((type) => (
                <button key={type} type="button" role="tab" aria-selected={selected === type} onClick={() => onSelect(type)}>
                  {ROUTE_NAME[type]}
                </button>
              ))}
            </div>
          )}
          <div className="rs-big2">
            <div>
              <small>소요 시간</small>
              <b>{formatDuration(route.durationS)}</b>
            </div>
            <div>
              <small>안전점수</small>
              <b className="sc" data-level={route.level}>
                {route.safetyScore}
                <span>/100 {LEVEL_LABEL[route.level]}</span>
              </b>
            </div>
          </div>
          <Ribbon route={route} longest={longest} large />
        </>
      )}

      {snap !== 'peek' && (
        <>
          {sameRoute ? (
            <p className="same" role="status">
              <b>최단경로와 안심경로가 일치해요.</b>
              가장 짧고 안전점수도 가장 높은 길이에요.
            </p>
          ) : (
            <div className="rs-sum" role="group" aria-label={sentence ?? '두 경로의 차이'}>
              <div>
                <b>{signedDistance(diff.extraM)}</b>
                <small>거리</small>
              </div>
              <div>
                <b>{signedDuration(diff.extraMin)}</b>
                <small>소요 시간</small>
              </div>
              <div>
                <b>{signedScore(diff.scoreGain)}</b>
                <small>안전점수</small>
              </div>
            </div>
          )}

          {sameRoute ? (
            <>
              {colHead(true)}
              <div className="rs-rows">
                <div className="rs-row static">
                  <span className="nm">최단경로 = 안심경로</span>
                  <span className="tm">{formatDuration(route.durationS)}</span>
                  <span className="sc" data-level={route.level}>
                    {route.safetyScore}
                  </span>
                  <span className="mt">{formatDistance(route.distanceM)}</span>
                  <Ribbon route={route} longest={longest} />
                </div>
              </div>
            </>
          ) : (
            <>
              {colHead(false)}
              <div className="rs-rows" role="radiogroup" aria-label="경로 선택">
                {TYPES.map(rowButton)}
              </div>
            </>
          )}

          {legend}
        </>
      )}

      {snap === 'full' && (
        <>
          {near && nearTypes.length > 0 && (
            <div className="rs-sec">
              <h3>
                경로 주변 안심시설<small>경로에서 {NEAR_M}m 안</small>
              </h3>
              <ul className="rs-fac">
                {nearTypes.map((type) => (
                  <li key={type}>
                    <i className={`fdot ${type}`} aria-hidden="true" />
                    <span>{FACILITY_LABEL[type].name}</span>
                    <b>
                      {near[type]}
                      {FACILITY_LABEL[type].unit}
                    </b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rs-sec">
            <h3>
              구간 구성<small>{ROUTE_NAME[sameRoute ? 'safe' : selected]} {formatDistance(route.distanceM)}</small>
            </h3>
            <LevelTable route={route} />
          </div>
        </>
      )}
    </section>
  )
}
