# 등대 API 서버 (`apps/api`)

NestJS 12 + Prisma 7 + PostgreSQL/PostGIS(Supabase). 명세는 [`docs/API.md`](../../docs/API.md), 테이블은 [`docs/ERD.md`](../../docs/ERD.md).

## 실행

Node.js 22 (22.13 이상, 23 미만 — `engines` `^22.13.0`). 명령은 모두 `apps/api`에서 실행한다.

```bash
npm ci              # 설치하면서 Prisma Client도 만든다 (postinstall: prisma generate)
npm run start:dev   # http://localhost:3000/api (파일을 고치면 다시 뜬다)
curl http://localhost:3000/api/health
# {"status":"ok","db":"ok","time":"2026-10-21T22:00:50+09:00"}
curl http://localhost:3000/api/daylight
# {"sunrise":"2026-10-25T06:46:00+09:00","sunset":"2026-10-25T17:42:00+09:00","isNight":true}
curl -G http://localhost:3000/api/places --data-urlencode 'q=충남대학교'
# {"places":[{"id":"12520707","name":"충남대학교 대덕캠퍼스","address":"대전 유성구 대학로 99",...}]}
curl -X POST http://localhost:3000/api/routes/search -H 'Content-Type: application/json' \
  -d '{"origin":{"lat":36.332294,"lng":127.434645},"destination":{"lat":36.33709,"lng":127.44509},"mode":"night"}'
# {"recommended":"safe","routes":[{"type":"shortest","distanceM":1279,...},{"type":"safe",...}],"sameRoute":true}
curl 'http://localhost:3000/api/facilities?bbox=36.35,127.33,36.37,127.36'
# {"facilities":[{"id":51877,"type":"cctv","location":{"lat":36.3622,"lng":127.3471}},...]}
```

- 환경변수는 저장소 루트의 `.env` 하나를 읽는다 (`apps/web`과 같은 파일). 이름은 루트 `.env.example`
- `/api/places`·`/api/routes/search`는 `KAKAO_REST_API_KEY`가 필요하다. 없으면 서버는 뜨고 두 API만 502 `EXTERNAL_API_ERROR`로 답한다
- `/api/routes/search`는 카카오 도보 경로(하루 1,000건 무료)를 검색 1회에 2건(최단·넓은 길 우선) 부른다. 같은 출발·도착(약 10m 안)은 DB `route_cache`에 24시간 남아 다시 부르지 않는다
- `/api/routes/search`는 안전점수를 DB `facilities`로 매겨서 DB가 없으면 502 `EXTERNAL_API_ERROR`로 답한다. 시설 데이터를 적재하기 전에는 모든 구간이 0점이라 늘 `sameRoute: true`다
- `DATABASE_URL`이 없거나 DB에 못 붙어도 서버는 뜨고, `/api/health`가 `"db": "error"`로 알려 준다. 이때 `/api/facilities`는 502 `EXTERNAL_API_ERROR`로 답한다
- `/api/facilities`는 DB `facilities` 테이블을 읽는다. 시설 데이터를 적재하기 전에는 늘 빈 목록이다
- `/api/daylight`는 `KASI_API_KEY`(공공데이터포털 서비스 키, 천문연 출몰시각 활용 신청된 것)가 필요하다. 없으면 오늘 값이 DB `sun_times`에 있을 때만 답하고, 없으면 502 `EXTERNAL_API_ERROR`. 천문연은 하루에 한 번만 부른다 (같은 날은 서버 메모리, 다시 켜면 `sun_times`)
- CORS는 개발 웹(`http://localhost:5173`)과 환경변수 `CORS_ORIGINS`(쉼표로 구분)에 적은 주소를 허용한다. 배포 서버(Vercel)에는 배포한 웹 주소를 넣는다. 로컬에서는 넣지 않아도 된다
- 카카오 로그인(`/api/auth/kakao`, 카카오 회원 탈퇴 포함, API.md 5장)은 `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`(카카오 콘솔 [REST API 키] > 클라이언트 시크릿)·`KAKAO_ADMIN_KEY`(어드민 키, 탈퇴 때 연결 끊기)가 필요하다. 없으면 서버는 뜨고 카카오 로그인·탈퇴만 502 `EXTERNAL_API_ERROR`. 리다이렉트 URI는 카카오·네이버·구글 모두 `CORS_ORIGINS`의 주소 루트만 받는다
- `JWT_SECRET`은 우리 로그인 토큰(HS256)의 서명 값이라 카카오·네이버·구글 로그인과 `GET·DELETE /api/auth/me`에 모두 필요하다. 32자 이상 무작위 값으로 두고, 로컬과 배포 값을 다르게 한다. 없거나 32자보다 짧으면 쓰지 않아(서버를 켤 때 경고 로그) 이 API들이 502 `EXTERNAL_API_ERROR`. 값을 바꾸면 이미 내준 토큰이 모두 401이 되어, 웹은 다음에 열 때 비회원으로 돌아간다 (다시 로그인)
- 네이버·구글 로그인(`/api/auth/naver`·`/api/auth/google`, 탈퇴 재인증 포함)은 `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`(네이버 개발자센터 앱), `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`(구글 클라우드 OAuth 클라이언트)이 필요하다. 없으면 그 서비스의 로그인·탈퇴만 502. 콘솔 설정은 `docs/EXTERNAL_APIS.md`
- 즐겨찾기(`/api/favorites`, API.md 5-1장)는 `FAVORITES_KEY`가 필요하다. 32바이트 무작위 값의 base64(`openssl rand -base64 32`)이고, 장소 정보를 암호화하는 데 쓴다. **로컬과 배포 서버(Vercel)에 같은 값**을 넣는다 — 같은 공용 DB를 써서, 다르면 한쪽에서 저장한 즐겨찾기를 다른 쪽이 못 읽는다(목록에서 빠지고 경고 로그). 없거나 32바이트가 아니면 서버를 켤 때 경고 로그를 남기고 즐겨찾기만 502 `EXTERNAL_API_ERROR`. 잃으면 저장된 즐겨찾기를 되살릴 수 없어서 학기 중에는 바꾸지 않는다
- 시크릿(카카오·네이버·구글)·어드민 키·`JWT_SECRET`·`FAVORITES_KEY`는 GitHub·노션에 적지 않는다. 어드민 키는 모든 사용자에게 관리자 권한으로 쓸 수 있는 키다

## DB 연결 (Supabase)

DB는 셋이 같이 쓰는 Supabase 프로젝트 하나다 (서울 리전, Postgres 17, PostGIS 3.3 — `extensions` 스키마, Data API 끔). 루트 `.env`에 두 줄을 넣는다.

| 변수 | Supabase Connect 화면 | 포트 | 쓰는 곳 |
|---|---|---|---|
| `DATABASE_URL` | Transaction pooler + 끝에 `?pgbouncer=true` | 6543 | 서버 실행 중 쿼리 |
| `DIRECT_URL` | Session pooler | 5432 | Prisma 마이그레이션, DBeaver |

```bash
DATABASE_URL="postgresql://postgres.<ref>:<비밀번호>@<pooler 호스트>:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<ref>:<비밀번호>@<pooler 호스트>:5432/postgres"
```

- 프로젝트 화면 위쪽 **Connect** → ORMs 탭 → Prisma를 고르면 두 줄이 같이 나온다. `[YOUR-PASSWORD]`는 대괄호까지 지우고 DB 비밀번호를 넣는다
- DB 비밀번호는 대시보드에서 다시 볼 수 없어 상협이 개인 채널로 전달한다. GitHub·노션에 적지 않는다
- Direct connection(`db.<ref>.supabase.co`)은 IPv6 전용이라 학교·집 네트워크에서 안 붙을 수 있어 쓰지 않는다
- `sslmode=require`를 붙이지 않는다. pg 드라이버가 인증서 검증까지 하는 뜻으로 읽어 `self-signed certificate in certificate chain` 오류가 난다
- `.env`를 고친 뒤에는 서버를 껐다 켠다 (`start:dev`는 `src`가 바뀔 때만 다시 뜬다)

| 오류 | 원인 |
|---|---|
| `password authentication failed` | 비밀번호가 틀림, `[YOUR-PASSWORD]`가 남음, 특수문자를 인코딩 안 함 |
| `Tenant or user not found` | 사용자 이름에 `.<ref>`가 빠짐, 호스트(리전)가 다름 |
| 5초 뒤 연결 시간 초과 | Direct connection 주소를 씀, 또는 무료 플랜이 7일 미사용으로 일시 정지됨 (대시보드에서 Restore) |

## 마이그레이션

테이블은 `prisma/migrations/`의 SQL로만 만들고 바꾼다 (ERD "Prisma·PostGIS 메모"). 데이터 적재 스크립트에서 테이블을 만들거나 고치지 않는다.

```bash
npx prisma migrate status   # 공용 DB에 적용 안 된 마이그레이션이 있는지
npx prisma migrate deploy   # 적용 안 된 마이그레이션을 적용
```

새 마이그레이션은 스키마를 고친 뒤 지금 DB와의 차이를 SQL로 뽑아 폴더를 만들고, 필요한 SQL을 덧붙인 다음 `deploy`한다.

```bash
mkdir -p prisma/migrations/<YYYYMMDDHHMMSS>_<이름>
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script \
  -o prisma/migrations/<YYYYMMDDHHMMSS>_<이름>/migration.sql
npx prisma migrate deploy
```

- **`prisma migrate dev`·`prisma migrate reset`은 쓰지 않는다.** 스키마와 DB가 어긋나면 DB를 초기화하자고 묻는데, 공용 DB라 셋의 데이터가 다 지워진다
- 적용한 `migration.sql`은 고치지 않는다. Prisma가 적용한 파일을 기록해 두어서, 바꾸려면 새 마이그레이션을 만든다
- 첫 마이그레이션(`20261021225702_init`)에는 Prisma 스키마로 못 쓰는 것을 SQL로 직접 넣었다: PostGIS 확장, `facilities.district` CHECK(대전 5개 구), 테이블 5개 RLS(정책 없음 — Data API 역할로는 행이 안 보이고, 테이블 주인인 `postgres`로 붙는 서버·적재는 영향 없음), `facility_types` 5행
- 안전점수 가중치는 마이그레이션이 아니라 `UPDATE facility_types SET weight = … WHERE code = …`로 바꾼다 (ERD `facility_types`)

## 시설 데이터 적재할 때

- `data_sources`에 적재 한 번당 한 행을 먼저 넣고, 그 `id`를 `facilities.data_source_id`에 넣는다
- 위치는 `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`. **경도(lng)가 먼저**다
- `district`는 `동구`·`중구`·`서구`·`유성구`·`대덕구` 중 하나이거나 NULL (CHECK). `data/processed/` CSV의 값이 이 다섯 개와 같다 (2026-10-21 확인)
- 건수는 DBeaver(Session pooler, 5432)나 Supabase Table Editor로 확인한다

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm run build` | `dist/`로 빌드 (`shared/types.ts`를 같이 컴파일해서 진입점은 `dist/apps/api/src/main.js`) |
| `npm run start:prod` | 빌드 결과 실행 |
| `npm run test` | 유닛 테스트 (Vitest, `src/**/*.spec.ts`) |
| `npm run test:e2e` | e2e 테스트 (`test/*.e2e-spec.ts`, DB 없이 가짜 연결로) |
| `npm run lint` | oxlint |
| `npx prisma generate` | `prisma/schema.prisma`를 고친 뒤 Prisma Client 다시 만들기 (`src/generated/`, 커밋 안 함) |

## 구조

```
apps/api/
├── prisma/schema.prisma    # ERD Must 테이블 5개 + users + 즐겨찾기 2개 + reports
├── prisma/migrations/      # DB에 적용하는 SQL (커밋함)
├── prisma.config.ts        # Prisma CLI 설정. 마이그레이션은 DIRECT_URL(Session pooler)로
└── src/
    ├── main.ts             # 서버 시작
    ├── app.setup.ts        # /api 접두사, CORS (main과 e2e가 같이 씀)
    ├── app.module.ts
    ├── common/
    │   ├── api-exception.ts  # 에러 응답 { error: { code, message } } (API.md 공통 규칙)
    │   ├── db-error.ts       # 로그에 남길 DB 에러 문장 (첫 줄만)
    │   ├── daejeon.ts        # 대전 범위 사각형, 주소가 대전인지
    │   ├── geo.ts            # 거리(m), "위도,경도" 읽기
    │   └── time.ts           # 한국 시간 ISO 문자열 (+09:00)
    ├── prisma/             # DB 연결 (DATABASE_URL, Transaction pooler)
    ├── kakao/              # 카카오 로컬 API(키워드·주소 검색)와 로그인(토큰 받기·사용자 정보·연결 끊기) 호출 (KAKAO_REST_API_KEY·KAKAO_CLIENT_SECRET·KAKAO_ADMIN_KEY)
    ├── naver/              # 네이버 로그인(토큰 받기·사용자 정보·토큰 삭제) 호출 (NAVER_CLIENT_ID·NAVER_CLIENT_SECRET)
    ├── google/             # 구글 로그인(토큰 받기·OpenID userinfo·토큰 취소) 호출 (GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET)
    ├── walk/               # 도보 경로 호출과 캐시 (route_cache). 티맵으로 바꾸면 여기만
    ├── health/             # GET /api/health
    ├── daylight/           # GET /api/daylight (천문연 출몰시각 호출, sun_times 캐시) (KASI_API_KEY)
    ├── places/             # GET /api/places
    ├── facilities/         # GET /api/facilities (지도 범위 안의 CCTV·안심벨·지구대, 종류·좌표가 같으면 하나로 묶음)
    ├── auth/               # POST /api/auth/kakao·naver·google, GET·DELETE /api/auth/me (users, 로그인 토큰 JWT_SECRET)
    ├── favorites/          # GET·POST·DELETE /api/favorites (favorite_places·favorite_routes, 장소 정보 AES-256-GCM 암호화 FAVORITES_KEY)
    ├── reports/            # POST /api/reports (위험 제보, 회원만. 점수 반영 FR-010은 다음 PR)
    └── routes/             # POST /api/routes/search (약 50m 구간, 안전점수, 안심경로 고르기 — 값은 safety.ts)
test/
├── *.e2e-spec.ts           # DB·카카오·천문연을 가짜로 바꾼 e2e
└── fixtures/               # 테스트용 카카오·천문연 응답 (실제 응답 일부)
```

## 메모

- API 응답 타입은 루트 `shared/types.ts`를 `import type`으로 쓴다. 명세를 바꾸면 이 파일부터 고친다
- 에러는 `ApiException`(`common/api-exception.ts`)으로 던진다. Nest 기본 예외 처리가 본문을 그대로 보내서 API.md 형식이 된다
- 카카오 호출 로그에는 검색어·좌표를 남기지 않는다 (사용자 위치가 들어 있을 수 있음). DB 에러도 첫 줄만 남긴다 (Prisma 에러 본문에 저장하려던 경로 좌표가 들어갈 수 있음)
- 위치 컬럼(`geography`)은 Prisma Client로 못 읽고 써서 `$queryRaw`로 다룬다 (ERD "Prisma·PostGIS 메모")
