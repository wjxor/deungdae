/**
 * 카카오 도보 경로 API 호출 테스트 — route_mode 3종 비교
 *
 * 실행 (레포 루트에서):
 *   node --env-file=.env scripts/kakao-walk-test.ts "<출발>" "<도착>"
 *   node --env-file=.env scripts/kakao-walk-test.ts --pairs scripts/route-pairs.json
 *
 * - 출발·도착: 장소 이름(카카오 키워드 검색, 대전시청 중심 반경 20km) 또는 "위도,경도"
 * - --pairs: 쌍 목록 파일의 출발·도착을 전부 돌려 요약표를 만든다 (안심경로 방식 결정용 비교 실험)
 * - route_mode 3종(BROAD_FIRST · SHORTEST · ACCESSIBLE)을 차례로 호출해 거리와 경로 겹침을 비교한다
 * - 응답 원본은 scripts/output/walk-<MODE>.json, --pairs면 scripts/output/<쌍 id>/walk-<MODE>.json 과
 *   scripts/output/route-mode-summary.json 에 저장한다 (gitignore 대상)
 * - 쿼터 사용: 쌍마다 도보 경로 3건 (+ 장소 이름이면 키워드 검색 최대 2건). 도보 무료 한도 1,000건/일
 * - 필요: .env의 KAKAO_REST_API_KEY, 카카오 앱의 [카카오맵] > [사용 설정] ON (꺼져 있으면 403)
 * - 의존성 없음. Node 22.18+ · 24의 타입 스트리핑으로 .ts를 바로 실행한다
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LatLng } from "../shared/types.ts";

// ── 타입 ────────────────────────────────────────────────

/** 출발·도착 지점 */
type Spot = {
  name: string;
  address: string;
  location: LatLng;
  /** 키워드 검색으로 찾았는지 (좌표 직접 입력이면 false) */
  fromSearch: boolean;
  /** 키워드 검색의 나머지 후보 — 첫 결과가 틀렸을 때 확인용 */
  alternatives: string[];
};

type RouteMode = "BROAD_FIRST" | "SHORTEST" | "ACCESSIBLE";

/** 카카오 도보 경로 응답 — 공식 문서 기준, 쓰는 필드만 */
type KakaoWalkResponse = {
  status: string;
  route?: {
    properties: { totalDistance: number; totalTime: number; landingUrl: string };
    legs: {
      properties: { distance: number; time: number };
      steps: {
        properties: { distance: number; guidance: string; time: number; x: number; y: number };
        path: { points: [number, number][] };
      }[];
    }[];
  };
};

/** 카카오 키워드 검색 응답 — 쓰는 필드만 */
type KakaoKeywordResponse = {
  documents: {
    place_name: string;
    road_address_name: string;
    address_name: string;
    x: string;
    y: string;
  }[];
};

/** route_mode 하나의 호출 결과 요약 */
type ModeResult = {
  mode: RouteMode;
  httpStatus: number;
  status: string;
  distanceM: number | null;
  durationS: number | null;
  path: LatLng[];
  guidances: { text: string; distanceM: number }[];
  landingUrl: string | null;
};

/** 비교 실험용 출발·도착 쌍 — scripts/route-pairs.json 의 한 항목 */
type RoutePair = {
  /** 결과 폴더 이름으로도 쓴다 */
  id: string;
  district: string;
  scene: string;
  origin: { name: string; location: LatLng };
  destination: { name: string; location: LatLng };
};

/** 두 경로의 겹침 */
type Overlap = {
  /** 허용 거리 안에서 겹치는 비율(%) — 양방향 중 작은 값 */
  percent: number;
  /** 한쪽 경로에만 있는 구간 길이(m) — 양방향 중 큰 값 */
  divergentM: number;
};

/** 모드 조합 하나의 겹침 비교 결과 (경로가 없으면 overlap은 null) */
type ModeOverlap = { modes: [RouteMode, RouteMode]; overlap: Overlap | null };

/** 쌍 하나의 실험 결과 — route-mode-summary.json 의 한 항목 */
type PairSummary = RoutePair & {
  straightM: number;
  results: Omit<ModeResult, "path" | "guidances">[];
  overlaps: ModeOverlap[];
};

/** 겹침 계산용 평면 좌표(m) */
type PlanePoint = { x: number; y: number };

// ── 상수 ────────────────────────────────────────────────

const WALK_URL = "https://dapi.kakao.com/v2/routing/walk";
const KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";

const ROUTE_MODES: RouteMode[] = ["BROAD_FIRST", "SHORTEST", "ACCESSIBLE"];

const MODE_LABELS: Record<RouteMode, string> = {
  BROAD_FIRST: "넓은 길 우선(기본값)",
  SHORTEST: "최단",
  ACCESSIBLE: "편안한 길",
};

/** 겹침을 비교할 모드 조합 */
const MODE_PAIRS: [RouteMode, RouteMode][] = [
  ["SHORTEST", "BROAD_FIRST"],
  ["SHORTEST", "ACCESSIBLE"],
  ["BROAD_FIRST", "ACCESSIBLE"],
];

/**
 * 두 경로를 같은 길로 보는 거리(m).
 * 안전점수 초안이 시설을 반경 30m로 세므로, 20m 안의 두 길은 거의 같은 시설을 센다.
 * 4차로 도로의 맞은편 인도 정도도 같은 길로 흡수한다.
 */
const OVERLAP_TOLERANCE_M = 20;

/** 겹침 계산 때 경로를 자르는 간격(m) */
const SAMPLE_STEP_M = 5;

const EARTH_RADIUS_M = 6_371_000;

/** 도보 API status 값의 의미 — 공식 문서 */
const STATUS_MESSAGES: Record<string, string> = {
  OK: "조회 성공",
  SAME_POINT: "출발지와 도착지가 같음",
  START_LINK_NOT_FOUND: "출발지 주변에서 도로를 찾지 못함",
  END_LINK_NOT_FOUND: "도착지 주변에서 도로를 찾지 못함",
  TOO_MANY_SEARCH_LINK: "탐색해야 할 구간이 너무 많음",
  TOO_FAR_AWAY: "출발지와 도착지가 너무 멂",
  ROUTE_RESULT_NOT_FOUND: "경로 결과 없음",
};

/** HTTP 에러별 원인 힌트 */
const HTTP_HINTS: Record<number, string> = {
  401: "키 인증 실패. JavaScript 키가 아니라 REST API 키인지, 복사할 때 공백이 섞이지 않았는지 확인하세요.",
  403: "권한 없음. 앱 설정의 [카카오맵] > [사용 설정]이 ON인지, 허용 IP 제한이 걸려 있지 않은지 앱 관리자에게 확인하세요.",
  429: "쿼터 초과. 오늘 한도를 다 썼거나, 이 앱이 소유 계정에서 카카오맵을 처음 켠 앱이 아니라서 무료 쿼터가 없을 수 있어요.",
};

/** 키워드 검색 범위 — 대전시청 중심 반경 20km (대전 전역 포함) */
const DAEJEON_CENTER: LatLng = { lat: 36.3504, lng: 127.3845 };
const SEARCH_RADIUS_M = 20_000;

/** 응답 원본을 저장할 폴더 — scripts/output/ (gitignore 대상) */
const OUTPUT_DIR = join(import.meta.dirname, "output");

/** "위도,경도" 입력 형식 */
const LAT_LNG_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

// ── 카카오 호출 ──────────────────────────────────────────

/** 카카오 API가 2xx가 아닌 응답을 줬을 때 던지는 에러 */
class KakaoHttpError extends Error {
  httpStatus: number;
  body: string;

  constructor(httpStatus: number, body: string) {
    super(`HTTP ${httpStatus}`);
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

/**
 * 카카오 REST API를 GET으로 호출한다.
 * 키는 Authorization 헤더에만 넣는다.
 */
async function kakaoGet<T>(
  url: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<{ httpStatus: number; data: T }> {
  const response = await fetch(`${url}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new KakaoHttpError(response.status, body);
  }
  return { httpStatus: response.status, data: JSON.parse(body) as T };
}

/**
 * 입력을 지점으로 바꾼다.
 * "위도,경도"면 그대로 쓰고, 아니면 대전 범위에서 키워드 검색한 첫 결과를 쓴다.
 */
async function resolveSpot(input: string, apiKey: string): Promise<Spot> {
  const match = LAT_LNG_PATTERN.exec(input);
  if (match) {
    const location = { lat: Number(match[1]), lng: Number(match[2]) };
    if (Math.abs(location.lat) > 90) {
      throw new Error(`"${input}" — 위도가 90을 넘어요. "위도,경도" 순서로 입력했는지 확인하세요.`);
    }
    return { name: "좌표 직접 입력", address: "-", location, fromSearch: false, alternatives: [] };
  }

  const { data } = await kakaoGet<KakaoKeywordResponse>(
    KEYWORD_URL,
    {
      query: input,
      x: String(DAEJEON_CENTER.lng),
      y: String(DAEJEON_CENTER.lat),
      radius: String(SEARCH_RADIUS_M),
      size: "5",
    },
    apiKey,
  );
  const [first, ...rest] = data.documents;
  if (!first) {
    throw new Error(`"${input}"을(를) 대전 범위에서 찾지 못했어요. 더 구체적인 이름이나 "위도,경도"로 다시 시도하세요.`);
  }
  return {
    name: first.place_name,
    address: first.road_address_name || first.address_name,
    location: { lat: Number(first.y), lng: Number(first.x) },
    fromSearch: true,
    alternatives: rest.map((doc) => doc.place_name),
  };
}

/**
 * route_mode 하나로 도보 경로를 요청해 요약하고, 응답 원본을 outputDir에 저장한다.
 */
async function requestWalkRoute(
  origin: Spot,
  destination: Spot,
  mode: RouteMode,
  apiKey: string,
  outputDir: string,
): Promise<ModeResult> {
  const params: Record<string, string> = {
    start_x: String(origin.location.lng),
    start_y: String(origin.location.lat),
    end_x: String(destination.location.lng),
    end_y: String(destination.location.lat),
    route_mode: mode,
  };
  // 검색으로 찾은 장소면 이름을 넘겨 카카오맵 링크에 표시되게 한다
  if (origin.fromSearch) params.s_name = origin.name;
  if (destination.fromSearch) params.e_name = destination.name;

  const { httpStatus, data } = await kakaoGet<KakaoWalkResponse>(WALK_URL, params, apiKey);
  await writeFile(join(outputDir, `walk-${mode}.json`), JSON.stringify(data, null, 2));

  const steps = data.route?.legs.flatMap((leg) => leg.steps) ?? [];
  return {
    mode,
    httpStatus,
    status: data.status,
    distanceM: data.route?.properties.totalDistance ?? null,
    durationS: data.route?.properties.totalTime ?? null,
    path: steps.flatMap((step) => step.path.points.map(toLatLng)),
    guidances: steps.map((step) => ({ text: step.properties.guidance, distanceM: step.properties.distance })),
    landingUrl: data.route?.properties.landingUrl ?? null,
  };
}

// ── 변환 ────────────────────────────────────────────────

/** 카카오 좌표 [x, y] = [경도, 위도]를 { lat, lng }로 바꾼다 */
function toLatLng([x, y]: [number, number]): LatLng {
  return { lat: y, lng: x };
}

/** 도(degree)를 라디안으로 */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 두 좌표 사이 직선거리(m) — 하버사인 공식 */
function straightDistanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

// ── 경로 겹침 ────────────────────────────────────────────

/**
 * 위경도를 기준점 중심의 평면 좌표(m)로 바꾼다.
 * 수 km 범위에서는 등장방형 근사 오차가 무시할 만하다.
 */
function toPlane(point: LatLng, reference: LatLng): PlanePoint {
  return {
    x: toRad(point.lng - reference.lng) * EARTH_RADIUS_M * Math.cos(toRad(reference.lat)),
    y: toRad(point.lat - reference.lat) * EARTH_RADIUS_M,
  };
}

/** 점 p에서 선분 ab까지 최단거리(m) */
function distanceToSegment(p: PlanePoint, a: PlanePoint, b: PlanePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 점 p에서 꺾은선 경로까지 최단거리(m) */
function distanceToPath(p: PlanePoint, path: PlanePoint[]): number {
  let min = Infinity;
  for (let i = 1; i < path.length; i++) {
    min = Math.min(min, distanceToSegment(p, path[i - 1], path[i]));
  }
  return min;
}

/**
 * 경로 a를 SAMPLE_STEP_M 간격으로 잘라, 경로 b에서 OVERLAP_TOLERANCE_M 안에 있는 조각의 길이를 더한다.
 * @returns a의 전체 길이와 그중 b와 겹치는 길이(m)
 */
function measureShared(a: PlanePoint[], b: PlanePoint[]): { totalM: number; sharedM: number } {
  let totalM = 0;
  let sharedM = 0;
  for (let i = 1; i < a.length; i++) {
    const start = a[i - 1];
    const end = a[i];
    const segmentM = Math.hypot(end.x - start.x, end.y - start.y);
    const pieces = Math.ceil(segmentM / SAMPLE_STEP_M);
    for (let k = 0; k < pieces; k++) {
      // 조각의 가운데 점으로 판정한다
      const t = (k + 0.5) / pieces;
      const sample = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      if (distanceToPath(sample, b) <= OVERLAP_TOLERANCE_M) sharedM += segmentM / pieces;
    }
    totalM += segmentM;
  }
  return { totalM, sharedM };
}

/**
 * 두 경로가 얼마나 겹치는지 잰다. 경로가 없으면(status가 OK가 아니면) null.
 * 양방향으로 재서 겹침률은 작은 값, 다른 길은 큰 값을 쓴다 — 차이를 작게 보지 않기 위해.
 */
function compareRoutes(pathA: LatLng[], pathB: LatLng[]): Overlap | null {
  if (pathA.length < 2 || pathB.length < 2) return null;
  const reference = pathA[0];
  const a = pathA.map((point) => toPlane(point, reference));
  const b = pathB.map((point) => toPlane(point, reference));
  const ab = measureShared(a, b);
  const ba = measureShared(b, a);
  if (ab.totalM === 0 || ba.totalM === 0) return null;
  return {
    percent: Math.min(ab.sharedM / ab.totalM, ba.sharedM / ba.totalM) * 100,
    // 부동소수 오차로 -0m가 나오지 않게 0 아래는 자른다
    divergentM: Math.max(0, ab.totalM - ab.sharedM, ba.totalM - ba.sharedM),
  };
}

/** 모드 조합(MODE_PAIRS)마다 겹침을 잰다 */
function compareModes(results: ModeResult[]): ModeOverlap[] {
  const pathOf = (mode: RouteMode) => results.find((result) => result.mode === mode)?.path ?? [];
  return MODE_PAIRS.map(([a, b]) => ({ modes: [a, b], overlap: compareRoutes(pathOf(a), pathOf(b)) }));
}

// ── 출력 ────────────────────────────────────────────────

/** 미터를 "1,234m"로 */
function formatMeters(meters: number | null): string {
  return meters === null ? "-" : `${meters.toLocaleString("ko-KR")}m`;
}

/** 초를 "18분 30초"로 */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

/** 좌표를 "위도, 경도" 소수점 6자리로 */
function formatLatLng({ lat, lng }: LatLng): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/** 지점 정보를 출력한다 */
function printSpot(role: string, spot: Spot): void {
  console.log(`${role}: ${spot.name}  (${spot.address})`);
  console.log(`      위도·경도 ${formatLatLng(spot.location)}`);
  if (spot.alternatives.length > 0) {
    console.log(`      다른 후보: ${spot.alternatives.join(", ")}`);
  }
}

/** SHORTEST 대비 거리 차를 "+120m (+5.2%)"로 */
function diffFromShortest(result: ModeResult, shortest: ModeResult | undefined): string {
  if (result.mode === "SHORTEST") return "기준";
  if (result.distanceM === null || !shortest?.distanceM) return "-";
  const diff = result.distanceM - shortest.distanceM;
  const percent = ((diff / shortest.distanceM) * 100).toFixed(1);
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff.toLocaleString("ko-KR")}m (${sign}${percent}%)`;
}

/** 겹침을 "96.1% · 다른 길 58m"로 */
function formatOverlap(overlap: Overlap | null): string {
  if (overlap === null) return "-";
  return `${overlap.percent.toFixed(1)}% · 다른 길 ${formatMeters(Math.round(overlap.divergentM))}`;
}

/** 모드 조합별 겹침을 출력한다 */
function printOverlaps(overlaps: ModeOverlap[]): void {
  for (const { modes, overlap } of overlaps) {
    console.log(`  ${modes[0]} ↔ ${modes[1]}: ${formatOverlap(overlap)}`);
  }
}

/** 모드별 비교표, 경로 겹침, 안내 문구를 출력한다 */
function printResults(results: ModeResult[]): void {
  const shortest = results.find((result) => result.mode === "SHORTEST");
  console.log("\n[비교표]");
  console.table(
    Object.fromEntries(
      results.map((result) => [
        result.mode,
        {
          설명: MODE_LABELS[result.mode],
          상태: result.status,
          거리: formatMeters(result.distanceM),
          시간: formatDuration(result.durationS),
          "최단 대비": diffFromShortest(result, shortest),
          "안내 단계": result.guidances.length,
          "좌표 점": result.path.length,
        },
      ]),
    ),
  );

  console.log(`\n[경로 겹침] 서로 ${OVERLAP_TOLERANCE_M}m 안이면 같은 길로 봄`);
  printOverlaps(compareModes(results));

  for (const result of results) {
    console.log(
      `\n[${result.mode}] ${MODE_LABELS[result.mode]} — ${formatMeters(result.distanceM)} · ${formatDuration(result.durationS)}`,
    );
    if (result.status !== "OK") {
      console.log(`  status ${result.status}: ${STATUS_MESSAGES[result.status] ?? "문서에 없는 상태값"}`);
      continue;
    }
    result.guidances.slice(0, 3).forEach((guidance, index) => {
      console.log(`  ${index + 1}. ${guidance.text} (${formatMeters(guidance.distanceM)})`);
    });
    if (result.guidances.length > 3) {
      console.log(`  … 외 ${result.guidances.length - 3}단계`);
    }
    console.log(`  카카오맵: ${result.landingUrl ?? "-"}`);
  }
}

/** 출력할 문자열에서 키 값을 가린다 (에러 본문에 키가 섞여 나올 경우 대비) */
function redact(text: string, apiKey: string): string {
  return text.replaceAll(apiKey, "***");
}

// ── 실행 ────────────────────────────────────────────────

/**
 * 출발·도착 한 쌍을 route_mode 3종으로 호출해 자세히 출력한다.
 * @returns 3종 모두 status OK인지
 */
async function runSingle(originInput: string, destinationInput: string, apiKey: string): Promise<boolean> {
  const origin = await resolveSpot(originInput, apiKey);
  const destination = await resolveSpot(destinationInput, apiKey);
  printSpot("출발", origin);
  printSpot("도착", destination);
  console.log(`직선거리: ${formatMeters(straightDistanceM(origin.location, destination.location))}\n`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const results: ModeResult[] = [];
  for (const [index, mode] of ROUTE_MODES.entries()) {
    const result = await requestWalkRoute(origin, destination, mode, apiKey, OUTPUT_DIR);
    console.log(
      `[${index + 1}/${ROUTE_MODES.length}] GET ${WALK_URL} route_mode=${mode} → HTTP ${result.httpStatus}, status ${result.status}`,
    );
    results.push(result);
  }

  printResults(results);
  console.log(`\n응답 원본: ${OUTPUT_DIR}/walk-<MODE>.json`);
  return results.every((result) => result.status === "OK");
}

/**
 * 쌍 목록 파일을 읽고 좌표 형식을 확인한다. 형식이 틀리면 API를 부르기 전에 멈춘다.
 */
async function loadPairs(filePath: string): Promise<RoutePair[]> {
  const pairs = JSON.parse(await readFile(filePath, "utf8")) as RoutePair[];
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error(`${filePath}: 쌍 목록(배열)이 비어 있어요.`);
  }
  for (const pair of pairs) {
    for (const { location } of [pair.origin, pair.destination]) {
      if (typeof location?.lat !== "number" || typeof location?.lng !== "number" || Math.abs(location.lat) > 90) {
        throw new Error(`${filePath}: "${pair.id}"의 좌표가 { lat, lng } 형식이 아니거나 위도·경도가 뒤바뀌었어요.`);
      }
    }
  }
  return pairs;
}

/** 쌍 파일의 지점을 Spot으로 (좌표를 이미 알고 있으므로 검색하지 않는다) */
function toSpot({ name, location }: RoutePair["origin"]): Spot {
  return { name, address: "-", location, fromSearch: false, alternatives: [] };
}

/**
 * 쌍 목록 전체를 route_mode 3종으로 호출해 쌍별 결과와 요약표를 출력하고, 요약을 JSON으로 저장한다.
 * @returns 모든 쌍·모드가 status OK인지
 */
async function runPairs(filePath: string, apiKey: string): Promise<boolean> {
  const pairs = await loadPairs(filePath);
  console.log(`쌍 ${pairs.length}개 · 도보 경로 호출 ${pairs.length * ROUTE_MODES.length}건`);
  console.log(`겹침 기준: 서로 ${OVERLAP_TOLERANCE_M}m 안이면 같은 길로 봄\n`);

  const summaries: PairSummary[] = [];
  for (const [index, pair] of pairs.entries()) {
    const origin = toSpot(pair.origin);
    const destination = toSpot(pair.destination);
    const straightM = straightDistanceM(origin.location, destination.location);
    console.log(
      `[${index + 1}/${pairs.length}] ${pair.id} (${pair.district}) ${origin.name} → ${destination.name} · 직선 ${formatMeters(straightM)}`,
    );

    const outputDir = join(OUTPUT_DIR, pair.id);
    await mkdir(outputDir, { recursive: true });
    const results: ModeResult[] = [];
    for (const mode of ROUTE_MODES) {
      results.push(await requestWalkRoute(origin, destination, mode, apiKey, outputDir));
    }

    const shortest = results.find((result) => result.mode === "SHORTEST");
    for (const result of results) {
      const detail = result.status === "OK" ? `${formatMeters(result.distanceM)} (${diffFromShortest(result, shortest)})` : "";
      console.log(`  ${result.mode.padEnd(11)} ${result.status} ${detail}`);
    }
    const overlaps = compareModes(results);
    printOverlaps(overlaps);
    console.log("");

    // 요약 파일에는 좌표·안내 문구를 빼고 숫자만 남긴다 (원본은 쌍 폴더에 있음)
    const numbers = results.map(({ mode, httpStatus, status, distanceM, durationS, landingUrl }) => ({
      mode,
      httpStatus,
      status,
      distanceM,
      durationS,
      landingUrl,
    }));
    summaries.push({ ...pair, straightM, results: numbers, overlaps });
  }

  console.log("[요약] 거리 차는 SHORTEST 대비, 겹침은 모드 두 개씩 비교");
  console.table(
    Object.fromEntries(
      summaries.map((summary) => {
        const shortest = summary.results.find((result) => result.mode === "SHORTEST");
        const distanceOf = (mode: RouteMode) => {
          const result = summary.results.find((item) => item.mode === mode);
          if (!result?.distanceM || !shortest?.distanceM) return "-";
          const percent = ((result.distanceM - shortest.distanceM) / shortest.distanceM) * 100;
          return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
        };
        const percentOf = (index: number) => {
          const overlap = summary.overlaps[index].overlap;
          return overlap ? `${overlap.percent.toFixed(0)}%` : "-";
        };
        const maxDivergentM = Math.max(0, ...summary.overlaps.map(({ overlap }) => overlap?.divergentM ?? 0));
        return [
          summary.id,
          {
            직선: formatMeters(summary.straightM),
            최단: formatMeters(shortest?.distanceM ?? null),
            "넓은길 차": distanceOf("BROAD_FIRST"),
            "편안한길 차": distanceOf("ACCESSIBLE"),
            "S↔B 겹침": percentOf(0),
            "S↔A 겹침": percentOf(1),
            "B↔A 겹침": percentOf(2),
            "최대 다른 길": formatMeters(Math.round(maxDivergentM)),
          },
        ];
      }),
    ),
  );

  const summaryPath = join(OUTPUT_DIR, "route-mode-summary.json");
  await writeFile(summaryPath, JSON.stringify(summaries, null, 2));
  console.log(`\n요약: ${summaryPath}`);
  console.log(`응답 원본: ${OUTPUT_DIR}/<쌍 id>/walk-<MODE>.json`);
  return summaries.every((summary) => summary.results.every((result) => result.status === "OK"));
}

// ── 진입점 ──────────────────────────────────────────────

/** 인자·키 확인 → 한 쌍 또는 쌍 목록 실행 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pairsFile = args[0] === "--pairs" ? args[1] : undefined;
  if (args[0] === "--pairs" ? !pairsFile : args.length < 2) {
    console.error('사용법 (레포 루트에서): node --env-file=.env scripts/kakao-walk-test.ts "<출발>" "<도착>"');
    console.error("       node --env-file=.env scripts/kakao-walk-test.ts --pairs scripts/route-pairs.json");
    console.error('       출발·도착은 장소 이름 또는 "위도,경도"');
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!apiKey) {
    console.error("KAKAO_REST_API_KEY가 비어 있어요. .env에 REST API 키를 넣고 레포 루트에서 --env-file=.env 옵션으로 실행하세요.");
    console.error("API는 호출하지 않았어요 (쿼터 사용 0건).");
    process.exitCode = 1;
    return;
  }

  try {
    const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    console.log(`=== 카카오 도보 경로 API 테스트 — ${now} ===\n`);

    const allOk = pairsFile ? await runPairs(pairsFile, apiKey) : await runSingle(args[0], args[1], apiKey);
    if (!allOk) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof KakaoHttpError) {
      console.error(`\n카카오 API 에러: HTTP ${error.httpStatus}`);
      console.error(`  원인 힌트: ${HTTP_HINTS[error.httpStatus] ?? "공식 문서의 에러 코드를 확인하세요."}`);
      console.error(`  응답 본문: ${redact(error.body, apiKey)}`);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    console.error(`\n실행 실패: ${redact(message + cause, apiKey)}`);
  }
}

await main();
