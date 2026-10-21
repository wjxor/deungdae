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
- 마이그레이션은 Supabase를 만든 뒤 추가한다
