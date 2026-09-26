/**
 * 카카오 도보 경로 API 호출 테스트 — route_mode 3종 비교
 *
 * 실행 (레포 루트에서):
 *   node --env-file=.env scripts/kakao-walk-test.ts "<출발>" "<도착>"
 *
 * - 출발·도착: 장소 이름(카카오 키워드 검색, 대전시청 중심 반경 20km) 또는 "위도,경도"
 * - route_mode 3종(BROAD_FIRST · SHORTEST · ACCESSIBLE)을 차례로 호출해 비교한다
 * - 응답 원본은 scripts/output/walk-<MODE>.json 에 저장한다 (gitignore 대상)
 * - 쿼터 사용: 도보 경로 3건 + 키워드 검색 최대 2건 (도보 무료 한도 1,000건/일)
 * - 필요: .env의 KAKAO_REST_API_KEY, 카카오 앱의 [카카오맵] > [사용 설정] ON (꺼져 있으면 403)
 * - 의존성 없음. Node 22.18+ · 24의 타입 스트리핑으로 .ts를 바로 실행한다
 */
import { mkdir, writeFile } from "node:fs/promises";
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

// ── 상수 ────────────────────────────────────────────────

const WALK_URL = "https://dapi.kakao.com/v2/routing/walk";
const KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";

const ROUTE_MODES: RouteMode[] = ["BROAD_FIRST", "SHORTEST", "ACCESSIBLE"];

const MODE_LABELS: Record<RouteMode, string> = {
  BROAD_FIRST: "넓은 길 우선(기본값)",
  SHORTEST: "최단",
  ACCESSIBLE: "편안한 길",
};

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
 * route_mode 하나로 도보 경로를 요청해 요약하고, 응답 원본을 파일로 저장한다.
 */
async function requestWalkRoute(
  origin: Spot,
  destination: Spot,
  mode: RouteMode,
  apiKey: string,
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
  await writeFile(join(OUTPUT_DIR, `walk-${mode}.json`), JSON.stringify(data, null, 2));

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

// ── 변환·출력 ────────────────────────────────────────────

/** 카카오 좌표 [x, y] = [경도, 위도]를 { lat, lng }로 바꾼다 */
function toLatLng([x, y]: [number, number]): LatLng {
  return { lat: y, lng: x };
}

/** 두 좌표 사이 직선거리(m) — 하버사인 공식 */
function straightDistanceM(a: LatLng, b: LatLng): number {
  const earthRadiusM = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * earthRadiusM * Math.asin(Math.sqrt(h)));
}

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

/** 경로 좌표가 완전히 같은 다른 모드 목록 */
function sameRouteModes(result: ModeResult, results: ModeResult[]): string {
  if (result.path.length === 0) return "-";
  const key = JSON.stringify(result.path);
  const same = results.filter((other) => other.mode !== result.mode && JSON.stringify(other.path) === key);
  return same.length > 0 ? same.map((other) => other.mode).join(", ") : "없음";
}

/** 모드별 비교표와 안내 문구를 출력한다 */
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
          "같은 경로": sameRouteModes(result, results),
        },
      ]),
    ),
  );

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

// ── 진입점 ──────────────────────────────────────────────

/** 인자·키 확인 → 지점 결정 → route_mode 3종 호출 → 비교 출력 */
async function main(): Promise<void> {
  const [originInput, destinationInput] = process.argv.slice(2);
  if (!originInput || !destinationInput) {
    console.error('사용법 (레포 루트에서): node --env-file=.env scripts/kakao-walk-test.ts "<출발>" "<도착>"');
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

    const origin = await resolveSpot(originInput, apiKey);
    const destination = await resolveSpot(destinationInput, apiKey);
    printSpot("출발", origin);
    printSpot("도착", destination);
    console.log(`직선거리: ${formatMeters(straightDistanceM(origin.location, destination.location))}\n`);

    await mkdir(OUTPUT_DIR, { recursive: true });
    const results: ModeResult[] = [];
    for (const [index, mode] of ROUTE_MODES.entries()) {
      const result = await requestWalkRoute(origin, destination, mode, apiKey);
      console.log(
        `[${index + 1}/${ROUTE_MODES.length}] GET ${WALK_URL} route_mode=${mode} → HTTP ${result.httpStatus}, status ${result.status}`,
      );
      results.push(result);
    }

    printResults(results);
    console.log(`\n응답 원본: ${OUTPUT_DIR}/walk-<MODE>.json`);

    if (results.some((result) => result.status !== "OK")) {
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
