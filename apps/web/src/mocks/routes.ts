import type {
  LatLng,
  Mode,
  Route,
  RouteSearchRequest,
  RouteSearchResponse,
  RouteType,
  SafetyLevel,
  Segment,
} from '../../../../shared/types'

// 목 데이터. 대전역 부근 → 우송대학교(36.33710, 127.44509)를 잇는 가짜 경로다.
// 목 장소(mocks/places.ts)가 우송대학교 하나라 도착지는 항상 우송대학교이므로, 경로도 그쪽에서 끝나게 했다.
// 실제 보행 도로를 따라가지 않는다. 화면(S3)에서 점선·구간 색상·비교 카드를 확인하려고 만든 것이다.
// 서버(POST /routes/search)가 생기면 이 파일은 지운다. (API.md 3장)

const ORIGIN: LatLng = { lat: 36.3326, lng: 127.4344 }
const DESTINATION: LatLng = { lat: 36.3371, lng: 127.44509 }

// 최단경로: 거의 직선. 중간에 한 번 꺾인다.
const SHORTEST_WAYPOINTS: LatLng[] = [
  ORIGIN,
  { lat: 36.3338, lng: 127.4375 },
  { lat: 36.3352, lng: 127.4408 },
  { lat: 36.3369, lng: 127.4435 },
  DESTINATION,
]

// 안심경로: 북쪽 큰길로 돌아간다 (CCTV·안심벨이 많은 쪽이라는 설정).
const SAFE_WAYPOINTS: LatLng[] = [
  ORIGIN,
  { lat: 36.3358, lng: 127.4350 },
  { lat: 36.3385, lng: 127.4372 },
  { lat: 36.3398, lng: 127.4418 },
  { lat: 36.3392, lng: 127.4462 },
  DESTINATION,
]

const SEGMENT_LENGTH_M = 50
const WALK_SPEED_MPS = 1.17 // API.md 예시(2140m = 1830s)와 비슷한 속도

// 구간 점수 모양. [경로 앞쪽 비율 상한, 점수]. 비율이 상한 이하인 구간에 그 점수를 쓴다.
const SHORTEST_SCORE_BANDS: [number, number][] = [
  [0.2, 66],
  [0.45, 52],
  [0.7, 24], // 어두운 구간 (빨강)
  [1, 44],
]
const SAFE_SCORE_BANDS: [number, number][] = [
  [0.3, 84],
  [0.6, 78],
  [0.8, 62], // 잠깐 주의 구간 (노랑)
  [1, 86],
]

const toRad = (deg: number) => (deg * Math.PI) / 180

function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
})

// 꺾이는 점들을 약 10m 간격으로 촘촘하게 만든다.
function densify(waypoints: LatLng[], stepM = 10): LatLng[] {
  const out: LatLng[] = [waypoints[0]]
  for (let i = 1; i < waypoints.length; i += 1) {
    const from = waypoints[i - 1]
    const to = waypoints[i]
    const steps = Math.max(1, Math.round(haversineM(from, to) / stepM))
    for (let s = 1; s <= steps; s += 1) out.push(lerp(from, to, s / steps))
  }
  return out
}

const levelOf = (score: number): SafetyLevel => (score >= 70 ? 'safe' : score >= 40 ? 'caution' : 'danger')

function scoreAt(ratio: number, index: number, bands: [number, number][]): number {
  const base = (bands.find(([upTo]) => ratio <= upTo) ?? bands[bands.length - 1])[1]
  const jitter = ((index * 7) % 9) - 4 // -4~+4. 구간마다 점수가 조금씩 다르게
  return Math.max(0, Math.min(100, base + jitter))
}

// 촘촘한 선을 약 50m 단위 구간으로 자른다. 앞 구간의 끝점이 다음 구간의 시작점이 된다. (API.md Segment)
function buildSegments(points: LatLng[], bands: [number, number][]): Segment[] {
  const chunks: LatLng[][] = []
  let current: LatLng[] = [points[0]]
  let length = 0
  for (let i = 1; i < points.length; i += 1) {
    current.push(points[i])
    length += haversineM(points[i - 1], points[i])
    if (length >= SEGMENT_LENGTH_M) {
      chunks.push(current)
      current = [points[i]]
      length = 0
    }
  }
  if (current.length > 1) chunks.push(current)

  const lengths = chunks.map((chunk) => chunk.slice(1).reduce((sum, p, i) => sum + haversineM(chunk[i], p), 0))
  const total = lengths.reduce((a, b) => a + b, 0)
  let walked = 0
  return chunks.map((path, i) => {
    walked += lengths[i]
    const safetyScore = scoreAt(walked / total, i, bands)
    return { path, distanceM: Math.round(lengths[i]), safetyScore, level: levelOf(safetyScore) }
  })
}

function buildRoute(type: RouteType, waypoints: LatLng[], bands: [number, number][]): Route {
  const path = densify(waypoints)
  const segments = buildSegments(path, bands)
  const distanceM = segments.reduce((sum, s) => sum + s.distanceM, 0)
  // 경로 점수는 구간 점수의 거리 가중 평균 (REQUIREMENTS 안전점수 규칙)
  const safetyScore = Math.round(segments.reduce((sum, s) => sum + s.safetyScore * s.distanceM, 0) / distanceM)
  return { type, distanceM, durationS: Math.round(distanceM / WALK_SPEED_MPS), safetyScore, path, segments }
}

const SHORTEST_ROUTE = buildRoute('shortest', SHORTEST_WAYPOINTS, SHORTEST_SCORE_BANDS)
const SAFE_ROUTE = buildRoute('safe', SAFE_WAYPOINTS, SAFE_SCORE_BANDS)

const recommendedOf = (mode: Mode): RouteType => (mode === 'night' ? 'safe' : 'shortest')

// POST /api/routes/search (API.md 3장). 두 경로가 다른 경우. 요청 좌표는 무시하고 항상 같은 경로를 돌려준다.
export async function mockRouteSearch(req: RouteSearchRequest): Promise<RouteSearchResponse> {
  return { recommended: recommendedOf(req.mode), routes: [SHORTEST_ROUTE, SAFE_ROUTE], sameRoute: false }
}

// 안심경로가 최단경로와 같은 경우 (sameRoute: true). 둘 다 담고 type만 다르다. (API.md 3장)
export async function mockRouteSearchSame(req: RouteSearchRequest): Promise<RouteSearchResponse> {
  return {
    recommended: recommendedOf(req.mode),
    routes: [SHORTEST_ROUTE, { ...SHORTEST_ROUTE, type: 'safe' }],
    sameRoute: true,
  }
}
