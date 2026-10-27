import type { Route, RouteSearchResponse, RouteType, SafetyLevel } from '../../../../shared/types'

export const ROUTE_NAME: Record<RouteType, string> = { shortest: '최단경로', safe: '안심경로' }

// 응답에서 한 종류의 경로를 꺼낸다. routes에는 shortest·safe가 항상 둘 다 있다 (API.md 3장)
export function pickRoute(res: RouteSearchResponse, type: RouteType): Route {
  const route = res.routes.find((r) => r.type === type)
  if (!route) throw new Error(`routes에 ${type} 경로가 없습니다`)
  return route
}

// 구간 거리를 안전도별로 합산한 비율(%). 정수로 반올림하고 합이 100이 되도록 맞춘다.
// 카드의 구간 막대에 쓴다 (FR-008). 서버는 비율을 주지 않아 프론트에서 합산한다.
export function levelShares(route: Route): Record<SafetyLevel, number> {
  const meters = levelMeters(route)
  const total = meters.safe + meters.caution + meters.danger
  const shares: Record<SafetyLevel, number> = { safe: 0, caution: 0, danger: 0 }
  if (total === 0) return shares

  LEVEL_ORDER.forEach((l) => {
    shares[l] = Math.round((meters[l] / total) * 100)
  })
  // 반올림으로 합이 99나 101이 되면 가장 큰 칸에서 맞춘다
  const gap = 100 - (shares.safe + shares.caution + shares.danger)
  const largest = LEVEL_ORDER.reduce((a, b) => (meters[b] > meters[a] ? b : a))
  shares[largest] += gap
  return shares
}

const toMinutes = (durationS: number) => Math.max(1, Math.round(durationS / 60))

export function formatDuration(durationS: number): string {
  const minutes = toMinutes(durationS)
  if (minutes < 60) return `${minutes}분`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

export function formatDistance(distanceM: number): string {
  const m = Math.round(distanceM)
  if (m < 1000) return `${m}m`
  return `${(distanceM / 1000).toFixed(1)}km`
}

// 안심경로가 최단경로와 얼마나 다른지 한 문장으로 말한다. 안전점수가 더 높지 않으면 말할 것이 없어 null.
// 점수 차이가 얼마나 작을 때 말하지 않을지는 팀에서 정하지 않았다 (ROADMAP "팀 회의").
export function compareSentence(shortest: Route, safe: Route): string | null {
  const scoreGain = safe.safetyScore - shortest.safetyScore
  if (scoreGain <= 0) return null

  const extraM = safe.distanceM - shortest.distanceM
  // 카드에 보이는 분(formatDuration)끼리 뺀다. 초 단위로 빼면 카드의 두 시간 차이와 1분 어긋날 수 있다
  const extraMin = toMinutes(safe.durationS) - toMinutes(shortest.durationS)
  if (extraM <= 0) return `최단경로보다 안전점수가 ${scoreGain}점 높아요.`

  const extra = extraMin > 0 ? `${formatDistance(extraM)}, ${extraMin}분` : formatDistance(extraM)
  return `최단경로보다 ${extra} 더 걸리지만 안전점수가 ${scoreGain}점 높아요.`
}

export type LevelRun = { level: SafetyLevel; meters: number }

// 구간을 같은 안전도끼리 이어 붙인다. 색 띠를 구간 수(약 50m마다 하나)만큼 칸으로 쪼개지 않고
// 색이 바뀌는 곳에서만 나누려는 것이다 (FR-008)
export function levelRuns(route: Route): LevelRun[] {
  const runs: LevelRun[] = []
  route.segments.forEach((s) => {
    const last = runs[runs.length - 1]
    if (last && last.level === s.level) last.meters += s.distanceM
    else runs.push({ level: s.level, meters: s.distanceM })
  })
  return runs
}

// 안전도별 거리(m). 구간 거리의 합이라 경로 전체 거리(distanceM)보다 조금 작을 수 있다 (API.md 3장)
export function levelMeters(route: Route): Record<SafetyLevel, number> {
  const meters: Record<SafetyLevel, number> = { safe: 0, caution: 0, danger: 0 }
  route.segments.forEach((s) => {
    meters[s.level] += s.distanceM
  })
  return meters
}

export type RouteDiff = { extraM: number; extraMin: number; scoreGain: number }

// 안심경로가 최단경로보다 얼마나 더 걷고, 더 걸리고, 더 안전한지. 음수는 더 짧다는 뜻이다
export function routeDiff(shortest: Route, safe: Route): RouteDiff {
  return {
    extraM: safe.distanceM - shortest.distanceM,
    // compareSentence와 같이 카드에 보이는 분끼리 뺀다
    extraMin: toMinutes(safe.durationS) - toMinutes(shortest.durationS),
    scoreGain: safe.safetyScore - shortest.safetyScore,
  }
}

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '')

export function signedDistance(m: number): string {
  return `${sign(m)}${formatDistance(Math.abs(m))}`
}

export function signedDuration(min: number): string {
  if (min === 0) return '0분' // formatDuration은 1분 미만도 1분으로 올린다
  return `${sign(min)}${formatDuration(Math.abs(min) * 60)}`
}

export function signedScore(n: number): string {
  return `${sign(n)}${Math.abs(n)}점`
}

// 경로 전체 점수의 등급. 서버가 구간 level을 정하는 기준(apps/api/src/routes/safety.ts의 toSafetyLevel,
// REQUIREMENTS "안전점수 규칙": 70 이상 안전, 40~69 주의, 39 이하 위험)과 같다.
// 서버는 경로 점수의 등급을 따로 주지 않아서 같은 숫자를 여기에도 둔다. 서버 기준이 바뀌면 함께 고친다
export function scoreLevel(score: number): SafetyLevel {
  if (score >= 70) return 'safe'
  if (score >= 40) return 'caution'
  return 'danger'
}

export const LEVEL_ORDER: SafetyLevel[] = ['safe', 'caution', 'danger']
export const LEVEL_LABEL: Record<SafetyLevel, string> = { safe: '안전', caution: '주의', danger: '위험' }
