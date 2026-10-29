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
├── docs/              # ROADMAP·HISTORY, REQUIREMENTS, API 명세, ERD, 외부 API, 실험 기록
├── shared/
│   └── types.ts       # 프론트·백엔드 공용 API 타입 (docs/API.md 기준)
├── apps/
│   ├── web/           # React + Vite (승민)
│   └── api/           # NestJS (상협)
├── scripts/           # 실험·검증용 스크립트 (카카오 도보 API 테스트 등)
└── data/              # Python 전처리 노트북·스크립트 (근영)
    └── validation/    # 원본 좌표 검증 스크립트·결과 목록
```

## 문서

- [로드맵](docs/ROADMAP.md) — 한눈에 보기, 지금 할 일, 팀에서 정해야 할 것, 결정된 것, 주차별 일정
- [기록](docs/HISTORY.md) — 주차별로 한 일 (최신순)
- [요구사항](docs/REQUIREMENTS.md) — FR/NFR, 화면, 데이터, 안전점수 규칙
- [API 명세](docs/API.md) — 엔드포인트, 공용 타입
- [ERD](docs/ERD.md) — DB 테이블 설계 (PostgreSQL + PostGIS)
- [외부 API](docs/EXTERNAL_APIS.md) — 카카오·티맵 API 확인 사실, 카카오 앱 콘솔 설정
- [route_mode 비교 실험](docs/route-mode-experiment.md) — 안심경로 방식 결정 근거 (카카오 도보 경로 3종의 겹침)
- [안전점수 실험](docs/safety-score-experiment.md) — 귀갓길 60쌍으로 정한 안전점수·안심경로 MVP 임시값의 근거

## 실행 방법

```bash
# 1. 환경변수
cp .env.example .env   # 값은 팀 채널에서 받아 채운다

# 2. 서버 (apps/api) — http://localhost:3000/api, 자세한 것은 apps/api/README.md
cd apps/api && npm ci && npm run start:dev
# 3. 클라이언트 (apps/web) — http://localhost:5173
cd apps/web && npm ci && npm run dev
# 4. 데이터 전처리 (data) — data/README.md 참고

# 5. 카카오 도보 API 테스트 — route_mode 3종의 거리·경로 겹침 비교 (Node 22.18+, 의존성 없음)
node --env-file=.env scripts/kakao-walk-test.ts "반석역" "노은도서관"
#    귀갓길 쌍 목록 일괄 비교 (쌍당 도보 API 3건, 결과: docs/route-mode-experiment.md)
node --env-file=.env scripts/kakao-walk-test.ts --pairs scripts/route-pairs.json
```

## 협업 규칙

- `main` 직접 push 금지. 기능 브랜치에서 작업하고 PR로 합친다 (1명 이상 확인 후 merge)
  - GitHub 룰셋 "main 보호"로 적용 (2026-09-26): 강제 push·`main` 삭제 금지, PR 필수 + 승인 1명
  - 예외: 저장소 관리자(상협)는 **PR에서만** 승인 없이 merge 가능, 직접 push는 불가. collaborator가 없어 승인해 줄 사람이 없는 동안 작업이 막히지 않게 하려는 것
  - 조원 합류 후 이 예외를 없앨지 팀 회의에서 정하려 했지만 다루지 않기로 함 (2026-10-18 상협). 룰셋은 지금 그대로이고, 바꿀 때는 저장소 Settings → Rules → Rulesets
- 브랜치 이름: `feat/FR-004-shortest-route`, `fix/...`, `docs/...`. 3명 팀이라 `develop` 브랜치는 두지 않는다
- merge는 **squash만** 허용하고, squash 커밋 제목은 PR 제목이다 (2026-10-22 상협, 저장소 Settings → General → Pull Requests). PR 하나가 `main`의 커밋 하나가 된다
  - 기본값은 커밋이 1개인 PR이면 그 커밋 메시지를 제목으로 써서 #12가 `Update .gitignore`로 들어갔고, #25는 이 설정 전이라 merge commit으로 들어가 브랜치 커밋(`Add files via upload`)이 그대로 남았다
- 머지된 PR의 브랜치는 GitHub가 자동으로 삭제한다 (저장소 설정 "Automatically delete head branches")
- 커밋 메시지에 요구사항 ID를 붙인다: `FR-004 최단경로 API 구현`. PR 제목이 `main`의 커밋 메시지가 되므로 PR 제목에도 붙인다
- **API 키·DB 접속 정보는 절대 커밋하지 않는다.** `.env`는 `.gitignore`에 들어 있다
- 좌표는 항상 `{ lat, lng }` 객체, 좌표계는 WGS84(EPSG:4326)
- 카카오 REST 키는 서버 환경변수로만. 프론트는 Supabase에 직접 붙지 않고 모든 요청은 NestJS를 거친다
