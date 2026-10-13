# 등대 — API 명세

작성일: 2026-09-16 · 갱신: 2026-10-13 · 상태: 초안 v0.4 (6~7주차 발표 전 확정)
Base URL: `/api` · 형식: JSON · 인증: `Authorization: Bearer <accessToken>`

## 공통 규칙

- 좌표는 항상 `{ "lat": number, "lng": number }` 객체. 배열 `[lat, lng]`는 쓰지 않는다 (순서 실수 방지)
- 거리 단위 m, 시간 단위 초, 점수는 0~100 정수
- 날짜·시각은 ISO 8601 문자열 (`2026-09-16T21:30:00+09:00`)
- 성공은 2xx + 본문, 실패는 아래 형식

```json
{ "error": { "code": "ROUTE_NOT_FOUND", "message": "경로를 찾을 수 없습니다" } }
```

| HTTP | code | 상황 |
|---|---|---|
| 400 | INVALID_INPUT | 필수 값 누락, 형식 오류, 출발지와 도착지가 같음 |
| 400 | OUT_OF_AREA | 대상 지역(대전광역시) 밖 좌표 |
| 400 | TOO_FAR | 출발지와 도착지가 도보 경로로 찾기에 너무 멂 (카카오 `TOO_FAR_AWAY`) |
| 401 | UNAUTHORIZED | 토큰 없음·만료 |
| 404 | ORIGIN_UNREACHABLE | 출발지 근처에 걸을 수 있는 길이 없음 (카카오 `START_LINK_NOT_FOUND`) |
| 404 | DESTINATION_UNREACHABLE | 도착지 근처에 걸을 수 있는 길이 없음 (카카오 `END_LINK_NOT_FOUND`) |
| 404 | ROUTE_NOT_FOUND | 그 밖의 경로 계산 실패 (카카오 `ROUTE_RESULT_NOT_FOUND` 등) |
| 409 | EMAIL_EXISTS | 회원가입 중복 |
| 502 | EXTERNAL_API_ERROR | 카카오·천문연 API 실패·응답 없음 |
| 503 | QUOTA_EXCEEDED | 카카오 도보 경로 하루 무료 한도(1,000건) 초과. 서버 캐시에 있는 같은 요청은 한도와 상관없이 응답한다 |

- 프론트는 `code`로 분기하고, `message`는 화면에 그대로 보여 줄 수 있는 한국어 문장이다
- 경로를 못 찾은 이유를 코드로 나눈 것은 안내 문구가 달라서다 (v0.4). 예: `OUT_OF_AREA`는 "대전에서만 쓸 수 있어요", `QUOTA_EXCEEDED`는 "오늘은 경로 검색이 많아 잠시 후 다시". B안이면 검색 1회에 도보 API를 3번 불러 하루 약 330회가 상한이라 시연 중에도 날 수 있다

## 공용 타입 (`shared/types.ts`)

프론트·백엔드가 이 파일을 함께 import한다. 명세를 바꾸면 이 파일부터 고친다.

```ts
export type LatLng = { lat: number; lng: number };

export type ErrorCode =
  | "INVALID_INPUT"
  | "OUT_OF_AREA"
  | "TOO_FAR"
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

export type ReportType = "dark" | "no_cctv" | "suspicious" | "others";

export type Report = {
  id: number;
  location: LatLng;
  type: ReportType;
  description: string | null;
  createdAt: string;
};

export type User = { id: number; email: string; nickname: string };
```

## 1. 상태 확인

### GET /api/health
```json
{ "status": "ok", "db": "ok", "time": "2026-09-16T21:30:00+09:00" }
```
2단계 검증용. 이게 뜨면 NestJS + Supabase 연결이 된 것.

## 1-1. 주야간 판별

### GET /api/daylight?lat=36.35&lng=127.38&date=2026-10-02
서버가 한국천문연구원 출몰시각 API를 호출해 그날의 일출·일몰 시각과 현재가 야간인지 돌려준다. 하루 한 번만 호출하고 서버에서 캐싱 (지역·날짜 단위). `date` 생략 시 오늘.

```json
{ "sunrise": "2026-10-02T06:27:00+09:00", "sunset": "2026-10-02T18:14:00+09:00", "isNight": true }
```

프론트는 앱 시작 시 이 값으로 토글 기본값을 정하고, 사용자가 토글을 누르면 그 값을 우선한다. 경로 검색 요청의 `mode`는 최종적으로 프론트가 정해서 보낸다 (FR-005).

## 2. 장소 검색

### GET /api/places?q=충남대학교&near=36.36,127.34
서버가 카카오 로컬 API를 호출해 결과를 `Place[]`로 정리해 돌려준다. `near`는 선택, 있으면 가까운 순.

```json
{ "places": [ { "id": "8394", "name": "충남대학교", "address": "대전 유성구 대학로 99", "location": { "lat": 36.3664, "lng": 127.3446 } } ] }
```

## 3. 경로 검색

### POST /api/routes/search
인증 불필요.

요청 `RouteSearchRequest`
```json
{ "origin": { "lat": 36.3664, "lng": 127.3446 }, "destination": { "lat": 36.3512, "lng": 127.3781 }, "mode": "night" }
```

응답 `RouteSearchResponse`
```json
{
  "recommended": "safe",
  "routes": [
    { "type": "shortest", "distanceM": 2140, "durationS": 1830, "safetyScore": 46, "path": [ ... ], "segments": [ ... ] },
    { "type": "safe",     "distanceM": 2380, "durationS": 2040, "safetyScore": 78, "path": [ ... ], "segments": [ ... ] }
  ],
  "sameRoute": false
}
```

- `mode`는 프론트가 정해서 보낸다 (FR-005: 일몰시각 자동 판별이든 수동 토글이든 서버는 결과만 받는다)
- `mode`와 무관하게 두 경로를 모두 돌려주고 `recommended`만 바뀐다. 프론트는 추천 경로를 기본 표시하고 탭으로 전환
- 안심경로가 최단경로와 같아도 `routes`에는 `shortest`·`safe`를 둘 다 담고(`path`·점수 등 내용이 같음) `sameRoute: true`로 알린다. 그래서 `recommended`에 해당하는 경로는 항상 `routes` 안에 있다. 프론트는 `sameRoute`면 탭 대신 "최단경로가 곧 안심경로"라는 안내를 보여 주는 식으로 처리한다 (v0.3, 2026-10-13 승민 질문으로 정리. v0.2는 "하나만 담고 `type`은 `shortest`"라 밤에는 `recommended: "safe"`인 경로가 없었음)
- "같다"는 안심경로 계산 결과가 최단경로와 같은 경로라는 뜻이다 (B안이면 안전점수가 가장 높은 후보가 최단 후보 자체일 때)
- 대상 지역(대전광역시 전체) 밖 좌표는 400 `OUT_OF_AREA`. 출발·도착 근처에 길이 없거나 너무 먼 경우 등 실패 이유별 코드는 공통 규칙의 에러 표

내부 동작: 안심경로 계산 방식(A 경유지 우회 / B 후보 비교 / C 자체 엔진)은 6~7주차 발표 전 팀 회의에서 확정. 어느 방식이든 응답 형식은 이 문서를 따른다

## 4. 안전 시설

### GET /api/facilities?bbox=36.35,127.33,36.37,127.36
FR-002 안전시설 아이콘 표시용. `bbox` = 남서 lat,lng, 북동 lat,lng. 가로등이 수천 개라 **줌 레벨이 일정 이상일 때만 호출**하고 bbox를 좁게 잡는다.

```json
{ "facilities": [ { "type": "street_light", "location": { "lat": 36.361, "lng": 127.345 } } ] }
```

## 5. 인증

### POST /api/auth/signup
```json
{ "email": "a@b.com", "password": "********", "nickname": "상협" }
```
→ 201 `{ "user": User, "accessToken": "..." }`

### POST /api/auth/login
```json
{ "email": "a@b.com", "password": "********" }
```
→ 200 `{ "user": User, "accessToken": "..." }`

### GET /api/auth/me  (인증 필요)
→ 200 `{ "user": User }`

- 비밀번호는 bcrypt 해시 저장. 토큰은 JWT, 만료 7일
- 프론트는 토큰을 메모리 + localStorage에 보관

## 6. 제보

사진 첨부(FR-009)는 포함 여부 미합의. 포함되면 `photoUrl` 필드를 추가하고 업로드 방식은 별도 정의.

### POST /api/reports  (인증 필요 — 로그인 여부 미합의, ROADMAP 참고)
```json
{ "location": { "lat": 36.361, "lng": 127.345 }, "type": "dark", "description": "가로등 고장" }
```
→ 201 `{ "report": Report }`

### GET /api/reports?bbox=...
→ 200 `{ "reports": Report[] }` — 지도에 제보 마커 표시용

## 7. 개발 순서

| 단계 | 먼저 만드는 엔드포인트 |
|---|---|
| 5~7주 | `GET /health`, `GET /places`, `POST /routes/search` (shortest만) — 데이터 구축과 병행 |
| 8~9주 | `POST /routes/search`에 safe 추가, `GET /facilities` (FR-002가 Must) |
| 13주 | `/auth/*`, `/reports` (Could) |

프론트는 이 문서의 JSON 예시를 그대로 목(mock) 데이터로 써서 화면을 먼저 만든다.
