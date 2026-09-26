# 등대 (Deungdae)

시간대별 안심 보행경로 추천 지도 서비스.
밤에는 최단 거리가 아니라 가로등·CCTV·안심벨이 많은 길로 안내한다.

2026학년도 2학기 AI창의융합캡스톤디자인 — 공공 안전데이터 기반 시간대별 안심 보행경로 추천 서비스

## 팀

| 담당 | 이름 | 맡는 것 |
|---|---|---|
| 백엔드 · DB | 고상협 | NestJS API, DB 스키마, 경로 탐색 로직 |
| 프론트엔드 | 전승민 | React 화면, 카카오맵 연동, PWA |
| 데이터 | 정근영 | 공공데이터 수집·정제·적재 |

## 기술 스택

| 파트 | 스택 |
|---|---|
| 클라이언트 | TypeScript + React, Vite, PWA, 카카오맵 JavaScript SDK |
| 서버 | TypeScript + NestJS, Node.js 22 LTS, Prisma |
| DB | PostgreSQL + PostGIS (Supabase) |
| 데이터 처리 | Python 3.12+ (pandas, GeoPandas) |

## 폴더 구조

```
.
├── CLAUDE.md          # Claude Code 작업 규칙
├── README.md
├── .env.example       # 환경변수 이름만 (값은 팀 채널로 공유)
├── docs/              # ROADMAP, REQUIREMENTS, API 명세, (ERD)
├── shared/
│   └── types.ts       # 프론트·백엔드 공용 API 타입 (docs/API.md 기준)
├── apps/
│   ├── web/           # React + Vite (승민)
│   └── api/           # NestJS (상협)
└── data/              # Python 전처리 노트북·스크립트 (근영)
```

## 문서

- [로드맵](docs/ROADMAP.md) — 현재 상태, 할 일, 주차별 일정, 미결정 사항
- [요구사항](docs/REQUIREMENTS.md) — FR/NFR, 화면, 데이터, 안전점수 규칙
- [API 명세](docs/API.md) — 엔드포인트, 공용 타입

## 실행 방법

> 앱 코드가 아직 없다. 세팅 후 이 자리를 채운다.

```bash
# 1. 환경변수
cp .env.example .env   # 값은 팀 채널에서 받아 채운다

# 2. 서버 (apps/api) — 작성 예정
# 3. 클라이언트 (apps/web) — 작성 예정
# 4. 데이터 전처리 (data) — data/README.md 참고
```

## 협업 규칙

- `main` 직접 push 금지. 기능 브랜치에서 작업하고 PR로 합친다 (1명 이상 확인 후 merge)
- 브랜치 이름: `feat/FR-004-shortest-route`, `fix/...`, `docs/...`
- 커밋 메시지에 요구사항 ID를 붙인다: `FR-004 최단경로 API 구현`
- **API 키·DB 접속 정보는 절대 커밋하지 않는다.** `.env`는 `.gitignore`에 들어 있다
- 좌표는 항상 `{ lat, lng }` 객체, 좌표계는 WGS84(EPSG:4326)
- 카카오 REST 키는 서버 환경변수로만. 프론트는 Supabase에 직접 붙지 않고 모든 요청은 NestJS를 거친다
