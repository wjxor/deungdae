// 프론트·백엔드 공용 타입. docs/API.md "공용 타입"과 항상 같게 유지한다.
// 명세를 바꾸면 이 파일부터 고친다.

export type LatLng = { lat: number; lng: number };

export type ErrorCode =
  | "INVALID_INPUT"
  | "OUT_OF_AREA"
  | "TOO_FAR"
  | "BBOX_TOO_LARGE"
  | "UNAUTHORIZED"
  | "ORIGIN_UNREACHABLE"
  | "DESTINATION_UNREACHABLE"
  | "ROUTE_NOT_FOUND"
  | "EMAIL_EXISTS"
  | "EXTERNAL_API_ERROR"
  | "QUOTA_EXCEEDED";

export type ApiError = {
  error: {
    code: ErrorCode;
    message: string;        // 화면에 그대로 보여 줄 수 있는 한국어 문장
  };
};

export type HealthResponse = { status: "ok"; db: "ok" | "error"; time: string };

export type DaylightResponse = { sunrise: string; sunset: string; isNight: boolean };

export type Mode = "day" | "night";
export type RouteType = "shortest" | "safe";
export type SafetyLevel = "safe" | "caution" | "danger";

export type Segment = {
  path: LatLng[];           // 구간 모양. 첫 점이 구간 시작, 마지막 점이 구간 끝 (앞 구간의 끝 = 다음 구간의 시작)
  distanceM: number;
  safetyScore: number;      // 0~100
  level: SafetyLevel;
};

export type Route = {
  type: RouteType;
  distanceM: number;
  durationS: number;
  safetyScore: number;      // 경로 전체 점수 0~100
  path: LatLng[];           // 지도에 선 그릴 때 사용
  segments: Segment[];      // 색상 구간
};

export type RouteSearchRequest = {
  origin: LatLng;
  destination: LatLng;
  mode: Mode;
};

export type RouteSearchResponse = {
  recommended: RouteType;   // day → shortest, night → safe. 항상 routes 안에 있는 type
  routes: Route[];          // 항상 shortest, safe 둘 다 (두 경로가 같아도 둘 다)
  sameRoute: boolean;       // 안심경로가 최단경로와 같은 경로면 true
};

// ERD facility_types.code와 같다
export type FacilityType = "street_light" | "security_light" | "cctv" | "emergency_bell" | "police";

export type Facility = {
  id: number;
  type: FacilityType;
  location: LatLng;
};

export type FacilitiesResponse = { facilities: Facility[] };

export type Place = {
  id: string;
  name: string;
  address: string;
  location: LatLng;
};

// 화면 S4 유형: 조명 부족 / CCTV 없음 / 우범지역 / 기타
export type ReportType = "dark" | "no_cctv" | "suspicious" | "others";

export type Report = {
  id: number;
  location: LatLng;
  type: ReportType;
  description: string | null;
  createdAt: string;
};

export type User = { id: number; email: string; nickname: string };
