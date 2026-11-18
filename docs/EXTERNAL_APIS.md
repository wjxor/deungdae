# 등대 — 외부 API 확인 사실 (공식 문서 기준)

카카오·티맵 API에 대해 공식 문서와 실제 호출로 확인한 것이다. 2026-10-29 ROADMAP에서 옮겼다.
수치는 바뀔 수 있으니 발표 직전 재확인한다. 무엇을 쓰기로 했는지는 ROADMAP "결정된 것".

## 카카오 도보 경로 `GET https://dapi.kakao.com/v2/routing/walk`
- 카카오디벨로퍼스 API. 심사 없이 사용 가능. 카카오모빌리티 사이트의 "도보 길찾기(제휴 파트너 전용)"는 다른 API — 3주차 발표자료의 "제휴 전용"은 이걸 본 것이다
- `route_mode`: `BROAD_FIRST`(넓은 길 우선, 기본) / `SHORTEST`(최단) / `ACCESSIBLE`(편안한 길)
- 경유지 `via_x`, `via_y` 최대 5개
- 응답: `route.legs[].steps[]` — 각 step은 거리·안내문구·시간·시작점 좌표와 `path.points`. 좌표는 `[x, y]` = `[경도, 위도]` → 서버에서 `{lat, lng}`로 변환
- 구간별 도로 종류·시설 정보는 주지 않는다
- 에러 상태: `START_LINK_NOT_FOUND`, `END_LINK_NOT_FOUND`, `TOO_MANY_SEARCH_LINK`, `TOO_FAR_AWAY`, `ROUTE_RESULT_NOT_FOUND` 등 — 처리 필요
- 카테고리 검색 `CS2`(편의점), `PM9`(약국)으로 24시 시설 보완 가능 (24시 시설은 2026-10-10 제외해 지금은 쓰지 않음)
- **앱 설정에서 [카카오맵] > [사용 설정] ON 필수.** 꺼져 있으면 403 `NotAuthorizedError` ("disabled OPEN_MAP_AND_LOCAL service") — 2026-09-27 키워드 검색 호출에서 실제 확인. 공식 문서상 카카오맵 REST API 전체에 필요
- 응답의 `landingUrl`은 출발·도착만 담은 카카오맵 링크라 `route_mode`와 관계없이 같다. 모드별 경로를 보여주려면 `path.points`를 직접 그려야 한다

## 카카오 무료 쿼터
- **계정 기준 첫 번째로 활성화한 앱에만 무료.** 테스트용 앱을 새로 만들지 말 것
- 일간: 도보 경로 1,000건 / 지도 Web SDK 300,000건 / 키워드·카테고리 검색 각 100,000건 / 주소↔좌표 100,000건. 월간 전체 3,000,000건
- 초과 시 유료 API 연결하면 도보 경로 건당 10원, 아니면 요청 실패
- B안은 경로 1회에 도보 API 2회(최단·넓은 길 우선, 2026-10-25 `docs/safety-score-experiment.md` — 편안한 길은 결과를 바꾸지 않아 뺌) → 하루 약 500회 경로 검색이 상한. 서버 캐싱 필수. A 보강(경유지 후보)을 붙이면 검색당 최대 4회라 약 250회 (승민 경유지 실험 PR #51, `docs/waypoint-experiment.md` "호출 비용")
- 수치는 변경될 수 있다고 문서에 명시 — 발표 직전 재확인

## 카카오맵 SDK 리소스 도메인 (2026-11-15 확인)
- SDK가 불러오는 스크립트·지도 타일·로드뷰는 2026-10-06부터 `*.kakaocdn.net`에서 받는다. 옛 `*.daumcdn.net`은 2026-11-30까지만 쓸 수 있고 12-01부터 따로 알리지 않고 끊길 수 있다 (카카오맵 데브톡 공지 2026-10-29, https://devtalk.kakao.com/t/api-daumcdn-net/152465)
- 공식 주소 `https://dapi.kakao.com/v2/maps/sdk.js`로 SDK를 부르면 바꿀 것이 없다. 우리 웹이 이렇게 부르고(`apps/web/src/lib/kakao.ts`), 로그인용 JS SDK는 처음부터 `t1.kakaocdn.net`이다(`apps/web/src/lib/kakaoSdk.ts`). 저장소에 `daumcdn` 주소는 없다
- 공지가 막는 것: SDK 내부 파일·타일 URL을 직접 만들어 부르기, 내부 파일을 내려받아 따로 저장해 쓰기, 옛 URL에서 도메인만 `kakaocdn`으로 바꾸기. PWA 서비스 워커(2026-11-18 PR #75)도 SDK 파일·지도 타일은 캐시하지 않는다 — 앱 파일만 미리 저장하고 다른 요청은 가로채지 않는다 (PR #64 본문 "지도·API 요청은 캐시하지 않는다"와 같다)
- CSP를 넣게 되면 `dapi.kakao.com`과 `*.kakaocdn.net`을 허용한다. 지금은 CSP가 없다

## 카카오 앱 콘솔 설정
- 앱은 상협 계정의 "등대" 하나다 (ROADMAP "결정된 것"). 무료 한도는 계정마다 처음 만든 앱에만 적용돼서 한 계정에 앱을 늘리지 않는다
- [카카오맵] > [사용 설정] ON 필수 — 위 "카카오 도보 경로"
- 사이트 도메인(JavaScript SDK 도메인): 개발용 `http://localhost:5173`(Vite 기본 포트, 조원 각자 PC에서 동작)과 배포한 웹 `https://deungdae-map.vercel.app`(2026-11-12) 두 개를 등록했다. 새 주소는 기존 값을 고쳐 쓰지 말고 추가한다 — 2026-11-12 배포 주소를 넣다가 localhost가 빠져 로컬 지도가 401로 안 뜬 적이 있다. 웹 PR 미리보기 주소는 등록하지 않았다. 폰 실기기 테스트는 배포한 HTTPS 주소로
- 등록 위치: 콘솔 개편(2025-12-03) 뒤로는 [앱 설정] > [앱] > [플랫폼 키] > [JavaScript 키] > [JavaScript SDK 도메인]. 옛 [플랫폼] > [Web] > [사이트 도메인]은 없어짐. 키마다 설정이 따로라 도메인을 등록한 키와 `.env`의 `VITE_KAKAO_JS_KEY`가 같은 키여야 한다
- REST API 키 "허용 IP 설정"은 쓰지 않는다. 서버가 Vercel(서버리스)이라 나가는 IP가 고정되지 않는다 (2026-11-11, ROADMAP "결정된 것")

### 카카오 로그인 설정 (FR-011, 2026-11-13)

웹이 JS SDK(JS 키)로 인가 코드를 받고 서버가 REST 키로 토큰을 바꾼다 (API.md 5장). 아래를 콘솔에 설정했다 (2026-11-13 상협). 꺼져 있거나 빠지면 카카오 화면에 KOE 에러가 뜬다. OpenID Connect는 쓰지 않아 꺼 둔다 (서버가 `/v2/user/me`로 회원번호·닉네임을 받아 ID 토큰이 필요 없음).

- [카카오 로그인] > [사용 설정] > 상태 ON. 꺼져 있으면 KOE004 ("앱 관리자 설정 오류")
- [카카오 로그인] > [동의항목] > 닉네임을 필수 동의로. 이메일(`account_email`)은 필수·선택·이용 중 동의 모두 "비즈 앱, 테스트 앱"만 쓸 수 있어 받지 않는다. 닉네임은 일반 앱도 "기본 제공" (2026-11-12 카카오 문서 "동의항목" 확인). 비즈 앱은 사업자 정보(개인은 앱 주인 본인인증)를 등록한 앱이다
- 리다이렉트 URI: `http://localhost:5173/`와 `https://deungdae-map.vercel.app/` (끝 `/`까지 같아야 한다). [앱] > [플랫폼 키] > [REST API 키]와 [JavaScript 키] 양쪽에 등록한다 — 인가 요청은 JS 키로, 토큰 요청은 REST 키로 하는데 문서가 어느 쪽 등록을 보는지 분명하지 않아서. 새 주소는 기존 값을 고쳐 쓰지 말고 추가한다. 웹 PR 미리보기 주소는 등록하지 않아 미리보기에서는 로그인이 안 된다
- [REST API 키] > [클라이언트 시크릿]은 ON(키를 만들면 기본 ON). 값은 서버 환경변수 `KAKAO_CLIENT_SECRET`에만
- 어드민 키는 서버 환경변수 `KAKAO_ADMIN_KEY`에만. 탈퇴 때 연결 끊기(`/v1/user/unlink`)에 쓴다. 모든 사용자에게 관리자 권한으로 쓸 수 있는 키라 웹·GitHub·노션에 두지 않는다
- 카카오 토큰 요청 에러: KOE320 인가 코드 만료·재사용(한 번만 쓸 수 있다), KOE303 인가 요청과 다른 redirect_uri, KOE010 클라이언트 시크릿이 틀림, KOE101 client_id가 틀림 (카카오 문서 "문제 해결")

## 네이버·구글 로그인 설정 (FR-011, 2026-11-17)

카카오와 같은 구조다 — 웹이 SDK 없이 인가 주소로 보내 코드를 받고, 서버가 Client Secret으로 토큰을 바꾼다 (API.md 5장). 2026-11-17 상협이 두 콘솔에 등록했고, 로컬에서 네이버·구글 로그인과 탈퇴(다시 로그인하면 동의 화면이 다시 뜸)를 확인했다 (11/18). 토큰은 저장하지 않고 이메일은 받지 않는다.

**네이버** (네이버 개발자센터, 상협 계정)
- 앱 "등대", 사용 API [네이버 로그인], 제공 정보는 별명만 필수 (이름·이메일·휴대전화는 받지 않는다)
- 서비스 환경 [PC웹]: 서비스 URL `https://deungdae-map.vercel.app`, Callback URL `http://localhost:5173/`와 `https://deungdae-map.vercel.app/` (끝 `/`까지 같아야 한다)
- "개발 중" 상태에서는 개발자센터 계정과 [멤버관리] 테스터 ID에 등록한 아이디만 로그인된다. 다른 아이디는 네이버가 "개발 중" 화면을 띄우고 넘어가지 않는다 (검수가 거절됐을 때도 같은 화면). 누구나 쓰게 하려면 [네이버 로그인 검수상태]에서 검수를 요청한다 — 등대 로그인 버튼 화면과 네이버 동의 화면 캡처를 붙인다. 검수 기간은 확인하지 못했다
- 서버 `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`, 웹 `VITE_NAVER_CLIENT_ID`(Client ID와 같은 값). 웹 변수에 Client Secret을 넣지 않는다 — `VITE_` 값은 번들에 그대로 나간다
- 호출: 토큰 `POST https://nid.naver.com/oauth2.0/token`(`grant_type=authorization_code`, `code`, 인가 요청과 같은 `state`), 사용자 정보 `GET https://openapi.naver.com/v1/nid/me`(`response.id`·`response.nickname`), 연결 끊기는 같은 토큰 주소에 `grant_type=delete`·`access_token`·`service_provider=NAVER`. 거부도 HTTP 200에 `error`로 온다(`invalid_request` 등)

**구글** (Google Cloud 콘솔 [Google 인증 플랫폼], 상협 계정)
- OAuth 동의 화면: 대상 외부, 게시 상태 테스트, 범위 `openid`·`.../auth/userinfo.profile`만. 기본 범위만 쓰면 테스트 상태여도 테스트 사용자 목록에 없는 사람도 로그인된다 (구글 도움말 "OAuth production readiness"). 로고는 올리지 않는다 (확인 절차가 필요해질 수 있다)
- 클라이언트: 유형 웹 애플리케이션, 승인된 리디렉션 URI `http://localhost:5173/`와 `https://deungdae-map.vercel.app/`. 보안 비밀(Client Secret)은 만들 때 한 번만 보이고, 잃어버리면 새로 만든다. 설정이 반영되기까지 5분~몇 시간 걸릴 수 있다 (그 사이 `redirect_uri_mismatch`)
- 서버 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`, 웹 `VITE_GOOGLE_CLIENT_ID`(클라이언트 ID와 같은 값)
- 호출: 토큰 `POST https://oauth2.googleapis.com/token`(코드 만료·재사용은 400 `invalid_grant`), 사용자 정보 `GET https://openidconnect.googleapis.com/v1/userinfo`(`sub`·`name`), 연결 끊기 `POST https://oauth2.googleapis.com/revoke`(`token=`)
- 돌아올 때 `code`·`state` 말고도 `scope`·`authuser`·`prompt`·`hd`, 보낸 곳을 알리는 `iss`(RFC 9207)를 붙인다. 웹이 주소에서 모두 지운다
- 앱 안 브라우저(카카오톡·인스타그램 등 웹뷰)에서는 구글이 OAuth를 막는다 — 403 `disallowed_useragent` 화면에서 멈추고 등대로 돌아오지 않는다. 웹은 카카오톡 안이면 `kakaotalk://web/openExternal?url=…`로 외부 브라우저에서 등대를 다시 열고, 그 밖의 앱 안 브라우저면 "사파리·크롬에서 열어 주세요"를 보여 준다. 카카오 로그인은 앱 안에서도 된다. 네이버는 앱 안에서 되는지 아직 확인하지 못했다

**공통**
- 웹 PR 미리보기 주소는 리다이렉트 URI에 등록하지 않아 미리보기에서는 로그인이 안 된다 (카카오와 같음). 새 주소는 기존 값을 고쳐 쓰지 말고 추가한다
- 탈퇴 때 연결을 끊으려면 그 사용자의 토큰이 필요해서(카카오처럼 어드민 키가 없다), 웹이 그 서비스 로그인을 한 번 더 거친다 (API.md 5장 `DELETE /api/auth/me`)

## 티맵 보행자 경로 (예비) `POST https://apis.openapi.sk.com/tmap/routes/pedestrian`
- `searchOption`: 0 추천 / 4 추천+대로우선 / 10 최단 / 30 최단거리+계단제외
- 경유지 `passList` 최대 5개, 응답 GeoJSON, 구간별 도로 종류(`roadType`)·시설(`facilityType`) 제공
- 무료 요금제 경로안내 일 1,000건, 초과 시 자동 차단
- 티맵 경로를 카카오 지도에 그려도 되는지 약관 미확인 — 교체 시 확인
