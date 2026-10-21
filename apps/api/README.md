# 등대 API 서버 (`apps/api`)

NestJS 12 + Prisma 7 + PostgreSQL/PostGIS(Supabase). 명세는 [`docs/API.md`](../../docs/API.md), 테이블은 [`docs/ERD.md`](../../docs/ERD.md).

## 실행

Node.js 22.13 이상. 명령은 모두 `apps/api`에서 실행한다.

```bash
npm ci              # 설치하면서 Prisma Client도 만든다 (postinstall: prisma generate)
npm run start:dev   # http://localhost:3000/api (파일을 고치면 다시 뜬다)
curl http://localhost:3000/api/health
# {"status":"ok","db":"ok","time":"2026-10-21T22:00:50+09:00"}
```

- 환경변수는 저장소 루트의 `.env` 하나를 읽는다 (`apps/web`과 같은 파일). 이름은 루트 `.env.example`
- `DATABASE_URL`이 없거나 DB에 못 붙어도 서버는 뜨고, `/api/health`가 `"db": "error"`로 알려 준다

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
├── prisma/schema.prisma    # ERD Must 테이블 5개 (users·reports는 13주차)
├── prisma/migrations/      # DB에 적용하는 SQL (커밋함)
├── prisma.config.ts        # Prisma CLI 설정. 마이그레이션은 DIRECT_URL(Session pooler)로
└── src/
    ├── main.ts             # 서버 시작
    ├── app.setup.ts        # /api 접두사, CORS (main과 e2e가 같이 씀)
    ├── app.module.ts
    ├── common/time.ts      # 한국 시간 ISO 문자열 (+09:00)
    ├── prisma/             # DB 연결 (DATABASE_URL, Transaction pooler)
    └── health/             # GET /api/health
```

## 메모

- API 응답 타입은 루트 `shared/types.ts`를 `import type`으로 쓴다. 명세를 바꾸면 이 파일부터 고친다
- 위치 컬럼(`geography`)은 Prisma Client로 못 읽고 써서 `$queryRaw`로 다룬다 (ERD "Prisma·PostGIS 메모")
