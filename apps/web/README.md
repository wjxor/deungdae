# 등대 웹 (`apps/web`)

React 19 + TypeScript + Vite + 카카오맵 JavaScript SDK. 모바일 웹앱(PWA)이다. 서버는 [`apps/api`](../api/README.md), API 명세는 [`docs/API.md`](../../docs/API.md), 화면은 [`docs/REQUIREMENTS.md`](../../docs/REQUIREMENTS.md) "화면".

## 실행

Node.js 22 (22.13 이상, 23 미만 — `engines` `^22.13.0`). 명령은 모두 `apps/web`에서 실행한다.

```bash
npm ci
npm run dev   # http://localhost:5173
```

지도와 경로 검색이 되려면 루트 `.env`(아래 환경변수)와 API 서버(`apps/api`의 `npm run start:dev`, 기본 `http://localhost:3000/api`)가 필요하다.

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (HMR) |
| `npm run build` | 타입 검사(`tsc -b`) 후 `dist/`로 빌드 |
| `npm run lint` | ESLint |
| `npm run preview` | 빌드 결과를 로컬에서 띄우기 |

## 환경변수

저장소 루트의 `.env` 하나를 읽는다 (`vite.config.ts`의 `envDir: '../..'`, `apps/api`와 같은 파일). 이름은 루트 `.env.example`. `.env`를 고친 뒤에는 개발 서버를 껐다 켠다.

| 변수 | 설명 |
|---|---|
| `VITE_KAKAO_JS_KEY` | 카카오 **JavaScript 키**(지도 SDK용). 카카오 콘솔에서 SDK 도메인(`http://localhost:5173` 등)을 등록한 앱의 키여야 한다. REST 키를 넣으면 에러가 난다 |
| `VITE_API_BASE_URL` | 서버 주소. 없으면 `http://localhost:3000/api` |
| `VITE_NAVER_CLIENT_ID` | 네이버 로그인 Client ID (서버 `NAVER_CLIENT_ID`와 같은 값). 없으면 [네이버로 시작하기]를 눌렀을 때 실패 안내 |
| `VITE_GOOGLE_CLIENT_ID` | 구글 OAuth 클라이언트 ID (서버 `GOOGLE_CLIENT_ID`와 같은 값). 없으면 [Google로 시작하기]를 눌렀을 때 실패 안내 |

- `VITE_` 접두사가 붙은 값은 클라이언트 번들에 그대로 들어간다. **카카오 REST 키, 네이버·구글 Client Secret 등 비밀 값은 넣지 않는다** (서버 `.env`에만)
- 카카오·네이버·구글 앱 콘솔 설정은 [`docs/EXTERNAL_APIS.md`](../../docs/EXTERNAL_APIS.md)

## 구조

```
apps/web/src/
├── main.tsx
├── App.tsx              # 화면 전환(브라우저 기록 사용), 화면을 오가도 남길 값(낮/밤·현재 위치·도착지·출발지)
├── screens/             # S1~S3 화면
│   ├── MapHome.tsx      # S1 지도 홈 (도착지 검색, 시설 아이콘)
│   ├── OriginPick.tsx   # S2 출발지 입력
│   ├── RouteCompare.tsx # S3 경로 비교 (최단·안심경로, 구간 색상), [안내 시작] 뒤 이동 중 화면
│   ├── ReportScreen.tsx # S4 위험 제보 (서버 POST /reports 연결은 남음)
│   └── Login.tsx        # 로그인
├── components/          # 지도·경로 레이어, 시트(RouteSheet·MyInfo·FavoritesSheet·SosSheet), 이동 중 패널(NavPanel), 설치 안내(InstallHint), 검색, 낮/밤 토글 등
├── hooks/
│   ├── useDaylightMode.ts  # 서버 /daylight의 일출·일몰을 기기 시각과 비교해 낮/밤 판별(켜 둔 채 일몰이 지나도 바뀜), 사용자가 누르면 그 값이 우선하고 자동 값이 바뀌면 다시 자동
│   ├── useGeolocation.ts   # 현재 위치와 권한 상태
│   ├── useWatchPosition.ts, useRouteProgress.ts, useHeading.ts  # 이동 중 화면: 위치 따라가기, 경로 위 진행·이탈·도착, 진행 방향
│   ├── useSimulatedWalk.ts # 개발 서버 `?walk` 가짜 걸음 (PC에서 이동 중 화면 확인)
│   ├── usePwaInstall.ts    # 안드로이드 크롬 설치 이벤트
│   └── useSheet.ts         # 바닥 시트(ESC·포커스·뒤로가기)
└── lib/
    ├── api.ts, apiError.ts # 서버 호출, 에러 응답({ error: { code, message } })
    ├── kakao.ts            # 카카오맵 SDK 불러오기
    ├── daylight.ts         # 일출·일몰 시각으로 낮/밤 판별, 다음 확인 시각 (서버 isNight와 같은 식)
    ├── auth.ts             # 로그인·탈퇴 (카카오·네이버·구글)
    ├── kakaoSdk.ts         # 카카오 JS SDK 불러오기 (로그인용, 지도 SDK와 다름)
    ├── socialLogin.ts      # 네이버·구글 인가 주소, 앱 안 브라우저 판별
    ├── favorites.ts        # 즐겨찾기 (서버 /api/favorites와 맞춤)
    ├── progress.ts         # 이동 중 화면: 경로 위 내 위치·남은 비율·이탈 거리
    └── geo.ts, routeSummary.ts, facilityIcon.ts
```

## 지금 동작

- **로그인**: 카카오·네이버·구글 로그인은 서버(`/api/auth/*`, API.md 5장)가 처리한다. [카카오로 시작하기]는 `lib/kakaoSdk.ts`가 카카오 JS SDK(JS 키)로, 네이버·구글은 `lib/socialLogin.ts`가 SDK 없이 인가 주소로 동의 화면에 보낸다. 셋 다 루트(`/`)로 돌아오면 `lib/auth.ts`가 인가 코드를 서버에 넘겨 받은 로그인 토큰을 localStorage(`deungdae.auth`)에 둔다. 세 서비스에 등록한 리다이렉트 URI가 `http://localhost:5173/`과 배포 주소라 로컬은 5173 포트에서만, PR 미리보기 주소에서는 안 된다. 네이버·구글 회원 탈퇴는 그 서비스 로그인을 한 번 더 거친다
- **즐겨찾기**: 회원 계정에 묶여 서버에 저장된다 (API.md 5-1장, 2026-11-22). 로그인하거나 앱을 다시 열면 불러오고, ☆를 누르면 화면을 먼저 바꾼 뒤 저장해서 실패하면 되돌리고 안내를 4초 보여 준다. 401(로그인 만료·탈퇴)이면 로그아웃시키고 지도 홈에서 다시 로그인하라고 안내한다(탈퇴 흐름과 같게). 경로는 출발지·도착지만 저장해 고르면 다시 검색한다
- **PWA**: manifest·앱 아이콘(PR #64, 2026-11-24 J2b로 바꿈 PR #97)과 서비스 워커(PR #75)가 있다. 서비스 워커는 앱 파일(JS·CSS·아이콘)만 미리 저장하고 지도·API 요청은 가로채지 않는다. 화면 주소(index.html)는 열 때마다 서버에서 먼저 받아 배포 직후 처음 열어도 새 버전이 뜨고, 오프라인이면 마지막으로 받은 화면을 쓴다 (PR #83). 쓰는 중인 화면은 새 버전이 와도 바꾸지 않고, 개발 서버(`npm run dev`)에서는 등록하지 않는다. 폰에서 설치해 보는 것은 ROADMAP "배포 주소에서 실기기 확인"

## 메모

- API 응답 타입은 루트 `shared/types.ts`를 `import type`으로 쓴다. 명세를 바꾸면 이 파일부터 고친다
- 좌표는 항상 `{ lat, lng }` 객체. 배열 `[lat, lng]`는 쓰지 않는다 (카카오 REST는 lng, lat 순이라 뒤집히기 쉬워서)
- 위치 권한은 HTTPS에서만 된다. `192.168.x.x`로 폰에서 접속하면 위치가 안 잡히니 배포 주소로 확인한다. 권한을 거부하면 S2에서 출발지를 주소 검색으로 넣는다
- iOS Safari 때문에 높이는 `100vh` 대신 `100dvh`를 쓴다
- 경로 API는 하루 무료 한도가 있어 "경로 찾기"를 눌렀을 때만 부르고, 낮/밤 토글은 이미 받은 두 경로의 표시만 바꾼다
