// 프론트·백엔드 공용 타입. docs/API.md "공용 타입"과 항상 같게 유지한다.
// 명세를 바꾸면 이 파일부터 고친다.

export type LatLng = { lat: number; lng: number };

export type Mode = "day" | "night";
export type RouteType = "shortest" | "safe";
export type SafetyLevel = "safe" | "caution" | "danger";

export type Segment = {
  from: LatLng;
  to: LatLng;
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
