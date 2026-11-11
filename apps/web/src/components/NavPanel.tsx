import type { Route } from '../../../../shared/types'
import { OFF_ROUTE_M, type NavProgress } from '../hooks/useRouteProgress'
import type { WatchState } from '../hooks/useWatchPosition'
import { formatDistance, formatDuration } from '../lib/routeSummary'

type Props = {
  route: Route
  watch: WatchState
  progress: NavProgress | null // 위치를 아직 못 받았으면 null
  onStop: () => void // 도중에 안내 종료: 경로 비교 화면으로
  onArrived: () => void // 도착 뒤 닫기: 이동이 끝났으니 지도 홈으로
}

// 이동 중 화면의 하단 패널. 받아 둔 경로를 따라 남은 거리·시간만 보여 주고 서버는 부르지 않는다.
// 경로를 벗어나도 다시 찾지 않고 알리기만 한다 (경로 호출은 사용자가 "경로 찾기"를 눌렀을 때만, CLAUDE.md)
export default function NavPanel({ route, watch, progress, onStop, onArrived }: Props) {
  const arrived = progress?.arrived === true
  const off = progress !== null && progress.offRouteM > OFF_ROUTE_M

  let body
  if (watch.status === 'denied') {
    body = <p className="nav-msg">위치 권한이 꺼져 있어 따라갈 수 없어요. 브라우저 설정에서 위치를 허용해 주세요.</p>
  } else if (watch.status === 'unavailable') {
    body = <p className="nav-msg">현재 위치를 잡지 못했어요. 신호가 잡히는 곳에서 다시 시도해 주세요.</p>
  } else if (arrived) {
    body = <p className="nav-msg arrived" role="status">도착했어요</p>
  } else if (!progress) {
    body = <p className="nav-msg" role="status">현재 위치를 찾는 중이에요</p>
  } else {
    const left = progress.totalM > 0 ? Math.max(0, 1 - progress.alongM / progress.totalM) : 1
    const remainingM = route.distanceM * left
    const remainingS = route.durationS * left
    body = (
      <>
        {off && (
          <p className="nav-off" role="alert">
            경로에서 {formatDistance(progress.offRouteM)} 벗어났어요. 경로 쪽으로 돌아가거나 안내를 끝내고 다시 찾아 주세요.
          </p>
        )}
        <div className="nav-nums">
          <div>
            <small>남은 거리</small>
            <b>{formatDistance(remainingM)}</b>
          </div>
          <div>
            <small>남은 시간</small>
            <b>{formatDuration(remainingS)}</b>
          </div>
        </div>
      </>
    )
  }

  return (
    <section className="sheet nav-panel" aria-label="이동 중 안내">
      {body}
      <button type="button" className="nav-stop" onClick={arrived ? onArrived : onStop}>
        {arrived ? '닫기' : '안내 종료'}
      </button>
    </section>
  )
}
