# 등대 웹 (`apps/web`)

React 19 + TypeScript + Vite + 카카오맵 JavaScript SDK. 모바일 웹앱(PWA 예정)이다. 서버는 [`apps/api`](../api/README.md), API 명세는 [`docs/API.md`](../../docs/API.md), 화면은 [`docs/REQUIREMENTS.md`](../../docs/REQUIREMENTS.md) "화면".

## 실행

Node.js 22.13 이상. 명령은 모두 `apps/web`에서 실행한다.

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

- `VITE_` 접두사가 붙은 값은 클라이언트 번들에 그대로 들어간다. **카카오 REST 키 등 비밀 값은 넣지 않는다** (서버 `.env`에만)
- 카카오 앱 콘솔 설정은 [`docs/EXTERNAL_APIS.md`](../../docs/EXTERNAL_APIS.md)

## 구조

```
apps/web/src/
├── main.tsx
├── App.tsx              # 화면 전환(브라우저 기록 사용), 화면을 오가도 남길 값(낮/밤·현재 위치·도착지·출발지)
├── screens/             # S1~S3 화면
│   ├── MapHome.tsx      # S1 지도 홈 (도착지 검색, 시설 아이콘)
│   ├── OriginPick.tsx   # S2 출발지 입력
│   ├── RouteCompare.tsx # S3 경로 비교 (최단·안심경로, 구간 색상)
│   └── Login.tsx        # 로그인
├── components/          # 지도·경로 레이어, 시트(RouteSheet·MyInfo·FavoritesSheet), 검색, 낮/밤 토글 등
├── hooks/
│   ├── useDaylightMode.ts  # 서버 /daylight 값이 기본, 사용자가 누르면 그 값이 우선
│   ├── useGeolocation.ts   # 현재 위치와 권한 상태
│   └── useSheet.ts         # 바닥 시트(ESC·포커스·뒤로가기)
└── lib/
    ├── api.ts, apiError.ts # 서버 호출, 에러 응답({ error: { code, message } })
    ├── kakao.ts            # 카카오맵 SDK 불러오기
    ├── auth.ts             # 로그인·탈퇴
    ├── favorites.ts        # 즐겨찾기
    └── geo.ts, routeSummary.ts, routeFacilities.ts, facilityIcon.ts
```

## 지금 동작

- **로그인**: 서버가 없어서 개발 서버(`npm run dev`)에서만 카카오 버튼이 가짜 회원("테스트 회원")으로 로그인된다. 배포 빌드는 "준비 중" 안내가 나온다. 네이버·구글 버튼은 막혀 있다. 서버 소셜 로그인이 붙으면 `lib/auth.ts`의 `requestSocialLogin`·`requestDeleteAccount`만 바꾼다 (ROADMAP "서버 소셜 로그인")
- **즐겨찾기**: 앱을 켜 둔 동안 메모리에만 있다. 새로고침하면 사라진다
- **PWA**: manifest·서비스 워커·앱 아이콘은 아직 없다 (ROADMAP "PWA 설치 설정")

## 메모

- API 응답 타입은 루트 `shared/types.ts`를 `import type`으로 쓴다. 명세를 바꾸면 이 파일부터 고친다
- 좌표는 항상 `{ lat, lng }` 객체. 배열 `[lat, lng]`는 쓰지 않는다 (카카오 REST는 lng, lat 순이라 뒤집히기 쉬워서)
- 위치 권한은 HTTPS에서만 된다. `192.168.x.x`로 폰에서 접속하면 위치가 안 잡히니 배포 주소로 확인한다. 권한을 거부하면 S2에서 출발지를 주소 검색으로 넣는다
- iOS Safari 때문에 높이는 `100vh` 대신 `100dvh`를 쓴다
- 경로 API는 하루 무료 한도가 있어 "경로 찾기"를 눌렀을 때만 부르고, 낮/밤 토글은 이미 받은 두 경로의 표시만 바꾼다
