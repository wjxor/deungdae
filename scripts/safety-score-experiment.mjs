/**
 * 안전점수 분포·정규화·안심경로 고르는 규칙 실험 (docs/safety-score-experiment.md)
 *
 * 실행 (레포 루트에서):
 *   (cd apps/api && npm run build)                       # 서버 코드를 그대로 쓰려고 빌드 결과(dist)를 import한다
 *   node --env-file=.env scripts/kakao-walk-test.ts --pairs scripts/route-pairs-score.json   # 처음 한 번 (도보 API 150건)
 *   node --env-file=.env scripts/safety-score-experiment.mjs          # 정제 결과(data/processed)로
 *   node --env-file=.env scripts/safety-score-experiment.mjs --db     # DB에 적재한 facilities 테이블로
 *
 * - 쌍: scripts/route-pairs.json(9월 장면 10쌍) + scripts/route-pairs-score.json(무작위 50쌍, make-score-pairs.py)
 * - 경로: scripts/output/<쌍 id>/walk-<MODE>.json (kakao-walk-test.ts가 저장한 카카오 응답). 카카오를 다시 부르지 않는다
 * - 구간 나누기·점수·고르는 규칙·구간 점수 SQL은 서버(apps/api/src/routes) 함수를 그대로 쓴다
 * - 기본은 정제 결과 CSV를 임시 테이블(pg_temp — 이 연결에서만 보이고 끝나면 사라짐)에 넣어 센다. 공용 테이블은 읽기만 한다
 * - 필요: .env의 DIRECT_URL(임시 테이블은 연결 하나를 계속 써야 해서 Session pooler), data/processed/*.csv(--db가 아니면)
 * - 결과는 화면에 출력하고 scripts/output/safety-score-summary.json에 저장한다 (gitignore 대상)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps/api');
const DIST = join(API, 'dist/apps/api/src');
const pg = createRequire(join(API, 'package.json'))('pg');
const { toWalkRoute } = await import(join(DIST, 'walk/kakao-walk.convert.js'));
const { splitPath } = await import(join(DIST, 'routes/segments.js'));
const { segmentScoreQuery, FACILITY_RADIUS_M } = await import(join(DIST, 'routes/safety-score.query.js'));
const { toSegmentScore, toRouteScore, toSafetyLevel, pickSafe, SCORE_CAP_RAW, SAFE_MIN_GAIN, SAFE_MAX_DETOUR } =
  await import(join(DIST, 'routes/safety.js'));

const USE_DB = process.argv.includes('--db');
const MODES = ['SHORTEST', 'BROAD_FIRST', 'ACCESSIBLE'];
const TYPES = ['street_light', 'security_light', 'cctv', 'emergency_bell', 'police'];
const KO = { street_light: '가로등', security_light: '보안등', cctv: 'CCTV', emergency_bell: '안심벨', police: '지구대' };
const KO_MODE = { SHORTEST: '최단', BROAD_FIRST: '넓은 길', ACCESSIBLE: '편안한 길' };
const DISTRICTS = ['동구', '중구', '서구', '유성구', '대덕구'];

// ── 작은 도구 ──────────────────────────────────────────

const sorted = (a) => [...a].sort((x, y) => x - y);
/** 선형 보간 백분위 (s는 정렬된 배열) */
const pct = (s, p) => {
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
const r1 = (x) => Math.round(x * 10) / 10;
const share = (n, total) => `${r1((100 * n) / total)}%`;

/** RFC 4180 CSV (따옴표 안 줄바꿈·"" 이스케이프). 정제 결과의 attributes 열에 줄바꿈이 있다 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, k) => [h.replace(/^﻿/, ''), r[k]])));
}

/** 정제 결과 5종을 pg_temp.facilities에 넣는다. 이 연결에서는 facilities가 공용 테이블 대신 이 임시 테이블을 가리킨다 */
async function loadTempFacilities(client) {
  const rows = TYPES.flatMap((t) => parseCsv(readFileSync(join(ROOT, `data/processed/facilities_${t}.csv`), 'utf8')));
  await client.query(`CREATE TEMP TABLE facilities (id serial PRIMARY KEY, type text NOT NULL, location geography(Point, 4326) NOT NULL)`);
  await client.query(
    `INSERT INTO pg_temp.facilities (type, location)
     SELECT t, ST_SetSRID(ST_MakePoint(x, y), 4326)::geography FROM unnest($1::text[], $2::float8[], $3::float8[]) AS u(t, y, x)`,
    [rows.map((r) => r.type), rows.map((r) => Number(r.lat)), rows.map((r) => Number(r.lng))],
  );
  await client.query(`CREATE INDEX ON pg_temp.facilities USING GIST (location)`);
  await client.query(`ANALYZE pg_temp.facilities`);
}

// ── 구간 원점수 세기 ────────────────────────────────────

const pairs = [
  ...JSON.parse(readFileSync(join(ROOT, 'scripts/route-pairs.json'), 'utf8')).map((p) => ({ ...p, set: '9월 장면' })),
  ...JSON.parse(readFileSync(join(ROOT, 'scripts/route-pairs-score.json'), 'utf8')).map((p) => ({ ...p, set: '무작위' })),
];

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
/** routes[쌍 id][MODE] = { distanceM, segments: [{ distanceM, raw, counts: { 종류: 개수 } }] } */
const routes = {};
let weights = {};
let queryMs = 0;
let queries = 0;
try {
  if (!USE_DB) await loadTempFacilities(client);
  const src = await client.query(
    `SELECT count(*)::int AS n, (SELECT relpersistence FROM pg_class WHERE oid = 'facilities'::regclass) AS p FROM facilities`,
  );
  console.log(`시설 ${src.rows[0].n.toLocaleString()}건 (${src.rows[0].p === 't' ? '정제 결과 → 임시 테이블' : 'DB facilities 테이블'})`);
  weights = Object.fromEntries((await client.query(`SELECT code, weight FROM facility_types`)).rows.map((r) => [r.code, r.weight]));
  console.log(`가중치(facility_types): ${TYPES.map((t) => `${KO[t]} ${weights[t]}`).join(' · ')}`);
  console.log(
    `정규화: 로그, 원점수 ${SCORE_CAP_RAW} 이상 100점 · 안심경로: 최단보다 ${SAFE_MIN_GAIN}점 이상 높고 우회 ${SAFE_MAX_DETOUR * 100}% 이하 · 반경 ${FACILITY_RADIUS_M}m`,
  );

  for (const pair of pairs) {
    routes[pair.id] = {};
    for (const mode of MODES) {
      const walk = toWalkRoute(JSON.parse(readFileSync(join(ROOT, `scripts/output/${pair.id}/walk-${mode}.json`), 'utf8')));
      const pieces = splitPath(walk.path);
      // 원점수는 서버와 같은 SQL로, 종류별 개수는 분석용으로 따로 센다
      const q = segmentScoreQuery(pieces.map((p) => p.path));
      const started = performance.now();
      const raw = await client.query(q.text, q.values);
      queryMs += performance.now() - started;
      queries++;
      const byType = await client.query(
        `SELECT s.i, f.type, count(*)::int AS n FROM unnest($1::int[], $2::text[]) AS s(i, wkt)
         JOIN facilities f ON ST_DWithin(f.location, ST_GeogFromText(s.wkt), $3::float8) GROUP BY s.i, f.type`,
        q.values,
      );
      const segments = pieces.map((p) => ({ distanceM: p.distanceM, raw: 0, counts: {} }));
      for (const r of raw.rows) segments[r.i].raw = r.raw;
      for (const r of byType.rows) segments[r.i].counts[r.type] = r.n;
      for (const s of segments) {
        const check = Object.entries(s.counts).reduce((sum, [type, n]) => sum + n * weights[type], 0);
        if (check !== s.raw) throw new Error(`${pair.id} ${mode}: 서버 SQL 원점수 ${s.raw} ≠ 종류별 합 ${check}`);
      }
      routes[pair.id][mode] = { distanceM: walk.distanceM, segments };
    }
  }
} finally {
  await client.end();
}

// ── 점수 매기기 (정규화 함수를 바꿔 끼울 수 있게) ─────

/** 정규화 함수로 후보 하나의 구간 점수·경로 점수를 매긴다. 경로 점수는 서버처럼 반올림한 구간 점수의 거리 가중 평균 */
const scoreRoute = (route, normalize) => {
  const segments = route.segments.map((s) => ({ distanceM: s.distanceM, safetyScore: Math.round(normalize(s.raw)) }));
  return { distanceM: route.distanceM, safetyScore: toRouteScore(segments), segments };
};

/**
 * 쌍마다 안심경로를 고른다. 기본 규칙은 서버 pickSafe, `rule`을 주면 그 조건(점수 차·우회)으로 고른다
 * @returns [{ pair, shortest, safe, mode }]
 */
const choose = (normalize, { modes = ['BROAD_FIRST', 'ACCESSIBLE'], rule } = {}) =>
  pairs.map((pair) => {
    const scored = Object.fromEntries(MODES.map((m) => [m, { ...scoreRoute(routes[pair.id][m], normalize), mode: m }]));
    const shortest = scored.SHORTEST;
    const others = modes.map((m) => scored[m]);
    let safe = shortest;
    if (!rule) safe = pickSafe(shortest, others);
    else {
      for (const c of others) {
        const okGain = c.safetyScore - shortest.safetyScore >= rule.minGain;
        const okDetour = c.distanceM <= shortest.distanceM * (1 + rule.maxDetour);
        if (okGain && okDetour && (safe === shortest || c.safetyScore > safe.safetyScore)) safe = c;
      }
    }
    return { pair, shortest, safe, mode: safe.mode };
  });

/** 고른 결과 요약: 다른 길을 고른 쌍 수, 점수 차·우회 중앙값·최대 */
const describe = (picks) => {
  const changed = picks.filter((p) => p.safe !== p.shortest);
  const gains = sorted(changed.map((p) => p.safe.safetyScore - p.shortest.safetyScore));
  const detours = sorted(changed.map((p) => (100 * (p.safe.distanceM - p.shortest.distanceM)) / p.shortest.distanceM));
  return {
    changed: changed.length,
    gainMedian: gains.length ? pct(gains, 0.5) : 0,
    gainMax: gains.at(-1) ?? 0,
    detourMedian: detours.length ? r1(pct(detours, 0.5)) : 0,
    detourMax: detours.length ? r1(detours.at(-1)) : 0,
    byMode: Object.fromEntries(MODES.map((m) => [m, picks.filter((p) => p.mode === m).length])),
  };
};

// ── 출력 ────────────────────────────────────────────────

const summary = { pairs: pairs.length, routes: pairs.length * MODES.length };
const shortestSegs = pairs.flatMap((pair) => routes[pair.id].SHORTEST.segments.map((s) => ({ ...s, pair })));
const rawS = sorted(shortestSegs.map((s) => s.raw));
const P = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];

const allSegs = pairs.reduce((n, p) => n + MODES.reduce((m, mode) => m + routes[p.id][mode].segments.length, 0), 0);
console.log(`\n## 1. 구간 원점수 — 최단경로 구간 ${rawS.length.toLocaleString()}개 (${pairs.length}쌍 · 경로 ${summary.routes}개 · 구간 ${allSegs.toLocaleString()}개)`);
console.log(`0점 ${share(rawS.filter((x) => x === 0).length, rawS.length)} · 평균 ${r1(rawS.reduce((a, b) => a + b, 0) / rawS.length)} · 최대 ${rawS.at(-1)}`);
console.log(P.map((p) => `P${p * 100} ${r1(pct(rawS, p))}`).join(' · '));
console.log(`경로 하나 구간 쿼리 평균 ${r1(queryMs / queries)}ms (이 PC ↔ DB 왕복 포함)`);
summary.raw = { segments: rawS.length, zero: rawS.filter((x) => x === 0).length, ...Object.fromEntries(P.map((p) => [`p${p * 100}`, pct(rawS, p)])) };

console.log('\n## 2. 쌍 묶음별, 표본 크기에 따른 기준값 흔들림');
for (const set of ['9월 장면', '무작위']) {
  const s = sorted(shortestSegs.filter((x) => x.pair.set === set).map((x) => x.raw));
  console.log(`${set}: 구간 ${s.length} · 0점 ${share(s.filter((x) => x === 0).length, s.length)} · P50 ${r1(pct(s, 0.5))} · P90 ${r1(pct(s, 0.9))} · P95 ${r1(pct(s, 0.95))}`);
}
let seed = 11;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const randomIds = pairs.filter((p) => p.set === '무작위').map((p) => p.id);
for (const k of [10, 30]) {
  const p90 = [], p95 = [];
  for (let t = 0; t < 200; t++) {
    const pick = new Set([...randomIds].sort(() => rand() - 0.5).slice(0, k));
    const s = sorted(shortestSegs.filter((x) => pick.has(x.pair.id)).map((x) => x.raw));
    p90.push(pct(s, 0.9));
    p95.push(pct(s, 0.95));
  }
  const a = sorted(p90), b = sorted(p95);
  console.log(`무작위 ${k}쌍씩 200번 뽑기: P90 ${r1(pct(a, 0.05))}~${r1(pct(a, 0.95))} · P95 ${r1(pct(b, 0.05))}~${r1(pct(b, 0.95))} (5~95% 범위)`);
}

console.log('\n## 3. 구별 (최단경로 구간)');
for (const d of DISTRICTS) {
  const s = sorted(shortestSegs.filter((x) => x.pair.district === d).map((x) => x.raw));
  console.log(`${d}: 구간 ${s.length} · 0점 ${share(s.filter((x) => x === 0).length, s.length)} · P50 ${r1(pct(s, 0.5))} · P75 ${r1(pct(s, 0.75))} · P90 ${r1(pct(s, 0.9))}`);
}

console.log('\n## 4. 종류별 기여 (최단경로 구간 — 원점수 합 중 비율 · 그 종류가 하나라도 있는 구간)');
const totalRaw = shortestSegs.reduce((a, s) => a + s.raw, 0);
summary.types = {};
for (const t of TYPES) {
  const contrib = shortestSegs.reduce((a, s) => a + (s.counts[t] ?? 0) * weights[t], 0);
  const present = shortestSegs.filter((s) => s.counts[t]).length;
  summary.types[t] = { share: contrib / totalRaw, present: present / shortestSegs.length };
  console.log(`${KO[t]}: ${share(contrib, totalRaw)} · ${share(present, shortestSegs.length)}`);
}
const onlyLights = shortestSegs.filter((s) => s.raw > 0 && TYPES.slice(2).every((t) => !s.counts[t])).length;
console.log(`가로등·보안등만 있는 구간 ${share(onlyLights, shortestSegs.length)}`);

console.log('\n## 5. 정규화 후보 (안심경로는 서버 규칙으로 고름)');
const C75 = pct(rawS, 0.75), C90 = pct(rawS, 0.9);
const rankOf = (x) => {
  let lo = 0, hi = rawS.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (rawS[m] <= x) lo = m + 1; else hi = m; }
  return lo;
};
const SCHEMES = [
  [`선형, ${r1(C75)}(P75)에서 100점`, (x) => Math.min(100, (100 * x) / C75)],
  [`선형, ${r1(C90)}(P90)에서 100점`, (x) => Math.min(100, (100 * x) / C90)],
  [`선형, ${SCORE_CAP_RAW}에서 100점`, (x) => Math.min(100, (100 * x) / SCORE_CAP_RAW)],
  [`로그, ${r1(C90)}(P90)에서 100점`, (x) => Math.min(100, (100 * Math.log1p(x)) / Math.log1p(C90))],
  [`로그, ${SCORE_CAP_RAW}에서 100점 ← 서버`, toSegmentScore],
  ['백분위 (표본 안 순위)', (x) => (100 * rankOf(x)) / rawS.length],
];
summary.schemes = {};
for (const [name, normalize] of SCHEMES) {
  const levels = { safe: 0, caution: 0, danger: 0 };
  for (const s of shortestSegs) levels[toSafetyLevel(Math.round(normalize(s.raw)))]++;
  const picks = choose(normalize);
  const routeScores = sorted(picks.map((p) => p.shortest.safetyScore));
  const d = describe(picks);
  summary.schemes[name] = { levels, routeScores: { p25: pct(routeScores, 0.25), p50: pct(routeScores, 0.5), p75: pct(routeScores, 0.75) }, ...d };
  console.log(
    `${name}: 구간 색 초록 ${share(levels.safe, shortestSegs.length)} 노랑 ${share(levels.caution, shortestSegs.length)} 빨강 ${share(levels.danger, shortestSegs.length)}` +
      ` · 최단경로 점수 P25/중앙/P75 ${Math.round(pct(routeScores, 0.25))}/${Math.round(pct(routeScores, 0.5))}/${Math.round(pct(routeScores, 0.75))}` +
      ` · 다른 길 ${d.changed}쌍 (점수 +${d.gainMedian}/+${d.gainMax}, 우회 +${d.detourMedian}%/+${d.detourMax}%)`,
  );
}
console.log(`원점수 → 점수(서버): ${[0, 1, 2, 3, 4, 5, 6, 8, 10].map((x) => `${x}→${toSegmentScore(x)}`).join(' · ')}`);

console.log('\n## 6. 안심경로 고르는 규칙 (정규화는 서버)');
const RULES = [
  ['1점이라도 높으면, 우회 상한 없음', { minGain: 1, maxDetour: Infinity }],
  ['5점 이상, 우회 30% 이하', { minGain: 5, maxDetour: 0.3 }],
  [`${SAFE_MIN_GAIN}점 이상, 우회 ${SAFE_MAX_DETOUR * 100}% 이하 ← 서버`, null],
  ['10점 이상, 우회 20% 이하', { minGain: 10, maxDetour: 0.2 }],
];
summary.rules = {};
for (const [name, rule] of RULES) {
  const d = describe(choose(toSegmentScore, rule ? { rule } : {}));
  summary.rules[name] = d;
  console.log(`${name}: 다른 길 ${d.changed}/${pairs.length}쌍 · 점수 +${d.gainMedian}(중앙)/+${d.gainMax}(최대) · 우회 +${d.detourMedian}%/+${d.detourMax}% · 고른 후보 ${MODES.map((m) => `${KO_MODE[m]} ${d.byMode[m]}`).join(', ')}`);
}

console.log('\n## 7. 후보 수 (서버 정규화·규칙)');
const three = choose(toSegmentScore);
const two = choose(toSegmentScore, { modes: ['BROAD_FIRST'] });
const differ = three.filter((p, k) => p.mode !== two[k].mode);
console.log(`후보 3개(최단·넓은 길·편안한 길) 다른 길 ${describe(three).changed}쌍 · 후보 2개(최단·넓은 길) ${describe(two).changed}쌍 · 결과가 다른 쌍 ${differ.length}`);
summary.candidates = { three: describe(three).changed, two: describe(two).changed, differ: differ.map((p) => p.pair.id) };

console.log('\n## 8. 점수 차가 큰 쌍 (서버 정규화, 우회 상한 없이 가장 높은 후보)');
const best = choose(toSegmentScore, { rule: { minGain: 1, maxDetour: Infinity } })
  .filter((p) => p.safe !== p.shortest)
  .sort((a, b) => b.safe.safetyScore - b.shortest.safetyScore - (a.safe.safetyScore - a.shortest.safetyScore))
  .slice(0, 5);
const zeroShare = (route) => share(route.segments.filter((s) => s.safetyScore === 0).length, route.segments.length);
for (const p of best) {
  const detour = (100 * (p.safe.distanceM - p.shortest.distanceM)) / p.shortest.distanceM;
  const picked = two.find((x) => x.pair.id === p.pair.id).safe !== two.find((x) => x.pair.id === p.pair.id).shortest;
  console.log(
    `${p.pair.id} (${p.pair.district}, ${p.pair.set}) 최단 ${p.shortest.distanceM}m ${p.shortest.safetyScore}점(0점 구간 ${zeroShare(p.shortest)})` +
      ` → ${KO_MODE[p.mode]} ${p.safe.safetyScore}점(0점 구간 ${zeroShare(p.safe)}), 우회 +${r1(detour)}% · 서버 규칙으로 ${picked ? '고름' : '안 고름'}`,
  );
}

writeFileSync(join(ROOT, 'scripts/output/safety-score-summary.json'), JSON.stringify(summary, null, 2));
console.log('\n요약: scripts/output/safety-score-summary.json');
