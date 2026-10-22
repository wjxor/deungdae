# 등대 — API 명세

작성일: 2026-09-16 · 갱신: 2026-10-22 · 상태: 초안 v0.4 (6~7주차 발표 전 확정)
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
| 400 | BBOX_TOO_LARGE | 시설 조회 범위(`bbox`)가 너무 넓음 |
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

// 지도에 표시하는 시설 (ERD facility_types.code 중 3종). 가로등·보안등은 안전점수에만 써서 응답에 없다
export type FacilityType = "cctv" | "emergency_bell" | "police";

export type Facility = {
  id: number;
  type: FacilityType;
  location: LatLng;
};

export type FacilitiesResponse = { facilities: Facility[] };

export type Place = {
  id: string;               // 목록 key용. 주소로 찾은 결과는 카카오 장소 ID가 없어 서버가 만든 값
  name: string;
  address: string;
  location: LatLng;
};

export type PlacesResponse = { places: Place[] };

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

### GET /api/daylight
서버가 한국천문연구원 출몰시각 API로 받은 **오늘** 대전의 일출·일몰 시각과 지금이 야간인지 돌려준다. 천문연 API는 하루 한 번만 부르고 서버에 캐싱한다 (ERD `sun_times`, 대전 한 지점 기준).

응답 `DaylightResponse`
```json
{ "sunrise": "2026-10-02T06:27:00+09:00", "sunset": "2026-10-02T18:14:00+09:00", "isNight": true }
```

- `isNight`는 서버의 현재 시각이 오늘 일출 전이거나 일몰 후이면 `true`
- 앱을 켜 둔 채로 일몰 시각이 지날 수 있어 `sunrise`·`sunset`도 함께 준다. 프론트는 이 시각을 기기 시각과 비교해 다시 판별할 수 있다
- v0.3의 `lat`·`lng`·`date` 파라미터는 뺐다 (v0.4). 대전 한 지점 기준이라 좌표가 결과를 바꾸지 않고, 오늘이 아닌 날짜를 주면 `isNight`의 뜻이 없어서다

프론트는 앱 시작 시 이 값으로 토글 기본값을 정하고, 사용자가 토글을 누르면 그 값을 우선한다. 경로 검색 요청의 `mode`는 최종적으로 프론트가 정해서 보낸다 (FR-005).

## 2. 장소 검색

### GET /api/places?q=충남대학교&near=36.36,127.34
서버가 카카오 로컬 API를 호출해 결과를 `Place[]`로 정리해 돌려준다.

- `q` (필수) = 장소명이나 주소 (`충남대학교`, `대전 유성구 대학로 99`). 비어 있으면 400 `INVALID_INPUT`. 위치 권한을 거부한 사용자가 출발지를 주소로 넣는 길이기도 하다 (iOS)
- `near` (선택) = `lat,lng`. 있으면 가까운 순
- **대전광역시 안의 장소만** 돌려준다. 대전 밖 장소를 고르면 경로 검색이 `OUT_OF_AREA`로 실패하기 때문
- 최대 15개, 페이지 없음 (카카오 검색 한 번에 받는 최대 개수). 결과가 없으면 에러가 아니라 `{ "places": [] }`

응답 `PlacesResponse`
```json
{ "places": [ { "id": "8394", "name": "충남대학교", "address": "대전 유성구 대학로 99", "location": { "lat": 36.3664, "lng": 127.3446 } } ] }
```

내부 동작: 카카오 키워드 검색을 먼저 부르고, 결과가 없으면 주소 검색을 한 번 더 부른다. 주소로 찾은 결과는 `name`이 주소와 같다. 대전 안인지는 결과 주소로 거른다 (구현 때 카카오 응답을 보고 조정).

출발지가 현재 위치일 때(FR-003) 입력칸에는 "현재 위치"라고 표시하고 기기 좌표를 그대로 경로 검색에 쓴다. 좌표를 주소로 바꾸는 API는 두지 않는다 (v0.4).

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

`segments`의 한 구간 (`Segment`)
```json
{ "path": [ { "lat": 36.3664, "lng": 127.3446 }, { "lat": 36.3661, "lng": 127.3448 }, { "lat": 36.3660, "lng": 127.3449 } ], "distanceM": 52, "safetyScore": 82, "level": "safe" }
```

- 구간은 경로를 약 50m씩 나눈 것이다 (REQUIREMENTS 안전점수 규칙). 프론트는 구간마다 `path`를 `level` 색으로 그리고, 구간을 순서대로 이어 그리면 경로 전체가 된다 (FR-008). v0.3까지는 시작·끝 두 점(`from`·`to`)만 있어서 구간 안에서 길이 꺾이면 직선으로 이어져 건물을 가로질렀다. `from`·`to`는 `path`의 처음·끝과 같아 v0.4에서 뺐다
- `mode`는 프론트가 정해서 보낸다 (FR-005: 일몰시각 자동 판별이든 수동 토글이든 서버는 결과만 받는다)
- `mode`와 무관하게 두 경로를 모두 돌려주고 `recommended`만 바뀐다. 프론트는 추천 경로를 기본 표시하고 탭으로 전환
- 안심경로가 최단경로와 같아도 `routes`에는 `shortest`·`safe`를 둘 다 담고(`path`·점수 등 내용이 같음) `sameRoute: true`로 알린다. 그래서 `recommended`에 해당하는 경로는 항상 `routes` 안에 있다. 프론트는 `sameRoute`면 경로 카드를 하나만 두고 "최단경로와 안심경로가 일치해요"라고 안내한다 (v0.3, 2026-10-13 승민 질문으로 정리. v0.2는 "하나만 담고 `type`은 `shortest`"라 밤에는 `recommended: "safe"`인 경로가 없었음. 안내 문구는 S3 화면에 맞춤 — PR #22, 2026-10-22. 그 전 예시는 "최단경로가 곧 안심경로")
- "같다"는 안심경로 계산 결과가 최단경로와 같은 경로라는 뜻이다 (B안이면 안전점수가 가장 높은 후보가 최단 후보 자체일 때)
- 대상 지역(대전광역시 전체) 밖 좌표는 400 `OUT_OF_AREA`. 출발·도착 근처에 길이 없거나 너무 먼 경우 등 실패 이유별 코드는 공통 규칙의 에러 표

내부 동작: 안심경로는 **B 기본 + A 보강**으로 계산한다 (2026-10-18 확정, ROADMAP "결정된 것"). 카카오 `route_mode` 후보를 안전점수로 비교하고, 후보가 서로 비슷하거나 최고 점수도 낮으면 경유지를 넣은 후보를 더한다. 응답 형식은 이 문서를 따른다

## 4. 안전 시설

### GET /api/facilities?bbox=36.35,127.33,36.37,127.36
FR-002 안전시설 아이콘 표시용. **CCTV·안심벨·지구대만** 돌려준다. 가로등·보안등은 합쳐 7만 개가 넘어 지도에 띄우지 않고 안전점수 계산에만 쓴다 (2026-10-14 승민 제안·상협 동의, REQUIREMENTS FR-002). 표시 대상도 대전 전체 3,590개(정제 후 CCTV 2,984 · 안심벨 575 · 지구대 31)라 **줌 레벨이 일정 이상일 때만 호출**하고 bbox를 좁게 잡는다.

- `bbox` (필수) = 남서 lat,lng, 북동 lat,lng. 가로·세로가 각각 4km를 넘으면 400 `BBOX_TOO_LARGE` (2026-10-15 PR #14에서 승민 제안·상협 동의. v0.4 초안은 2km였는데 폰 레벨 5·PC 레벨 4 화면이 2km를 넘어 아이콘이 안 나와서 늘렸다. 4km면 한 번에 최대 약 610개(같은 좌표를 묶지 않으면 약 720개)라 클러스터러 없이 그린다)
- `type`은 `cctv`·`emergency_bell`·`police` 중 하나이고, 값은 ERD `facility_types.code`와 같다
- `id`는 지도를 옮길 때 bbox가 겹쳐 같은 시설이 다시 올 때 마커 중복을 거르는 데 쓴다
- 같은 좌표에 CCTV가 여러 대인 곳(461곳)을 마커 하나로 묶을지는 데이터 정제 기준(ROADMAP)이 정해진 뒤 정한다

응답 `FacilitiesResponse`
```json
{ "facilities": [
  { "id": 51877, "type": "cctv", "location": { "lat": 36.3622, "lng": 127.3471 } },
  { "id": 74012, "type": "emergency_bell", "location": { "lat": 36.361, "lng": 127.345 } }
] }
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
