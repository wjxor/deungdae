/**
 * A 보강 경유지 실험 — "안심시설 밀집 지점" 방식 (docs/waypoint-experiment.md)
 *
 * 최단경로와 넓은 길 우선 경로 근처에서 시설 가중치가 몰린 지점을 경유지로 넣은 후보가
 * 지금 규칙(B안: 5점 이상·우회 20% 이하)으로 안심경로가 되는지, 얼마나 더 나은지 본다.
 *
 * 실행 (레포 루트에서):
 *   (cd apps/api && npm run build)                        # 서버 코드를 그대로 쓰려고 dist를 import한다
 *   node --env-file=.env scripts/waypoint-experiment.mjs baseline    # 최단·넓은 길 우선을 카카오에서 받아 저장 (쌍마다 2건)
 *   node --env-file=.env scripts/waypoint-experiment.mjs candidates  # 경유지 후보를 DB에서 고른다 (카카오 안 부름)
 *   node --env-file=.env scripts/waypoint-experiment.mjs probe       # 경유지 파라미터 형식 확인 (카카오 1~2건)
 *   node --env-file=.env scripts/waypoint-experiment.mjs route       # 경유지를 넣은 경로를 받아 저장 (쌍마다 최대 2건)
 *   node --env-file=.env scripts/waypoint-experiment.mjs report      # 점수를 매기고 지금 결과와 비교 (카카오 안 부름)
 *
 * 옵션
 *   --ids a,b,c      이 쌍만 (처음에는 몇 쌍으로 시험해 보는 용도)
 *   --types cctv,emergency_bell,police   밀집 지점을 셀 시설 종류 (기본: 5종 전부). 안심시설만 세는 변형을 보려는 것
 *   --max-calls N    이 실행에서 카카오를 부를 최대 건수 (기본 150). 하루 한도 1,000건은 팀이 같이 쓴다
 *
 * - 쌍: scripts/route-pairs.json(9월 장면 10쌍) + scripts/route-pairs-score.json(무작위 50쌍) — 안전점수 실험과 같다
 * - 카카오 좌표는 서버처럼 소수 4자리로 반올림해 부른다. 응답은 scripts/output/waypoint/ 에 저장해 다시 부르지 않는다 (gitignore)
 * - 점수·구간 나누기·고르는 규칙은 서버(apps/api/src/routes) 함수를 그대로 쓴다. 시설은 DB facilities 테이블(읽기만)
 * - 필요: .env의 KAKAO_REST_API_KEY, DIRECT_URL
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps/api');
const DIST = join(API, 'dist/apps/api/src');
const OUT = join(ROOT, 'scripts/output/waypoint');
// Windows에서는 import()에 경로가 아니라 file URL을 줘야 한다
const load = (rel) => import(pathToFileURL(join(DIST, rel)).href);
const pg = createRequire(join(API, 'package.json'))('pg');
const { toWalkRoute } = await load('walk/kakao-walk.convert.js');
const { splitPath } = await load('routes/segments.js');
const { segmentScoreQuery } = await load('routes/safety-score.query.js');
const { toSegmentScore, toRouteScore, pickSafe, SAFE_MIN_GAIN, SAFE_MAX_DETOUR } = await load('routes/safety.js');

// ── 실험 값 (이 문서에서 바꿔 가며 본다) ───────────────────────
const CORRIDOR_M = 250; // 최단·넓은 길 우선 경로에서 이 안의 시설을 경유지 후보로 본다
const OFF_ROUTE_M = 60; // 최단경로 위(이 안)의 지점은 경로를 바꾸지 못하므로 뺀다
const DENSITY_M = 50; // 밀집도 = 후보 지점 반경 이 안 시설의 가중치 합
const END_MARGIN_M = 150; // 출발·도착에서 이만큼은 떨어진 지점만 (끝에서 되돌아오는 경유지 방지)
const SEPARATION_M = 150; // 경유지끼리 이만큼은 떨어뜨린다
const MAX_VIA_DETOUR = 1.4; // 출발→경유지→도착 직선 합이 최단 거리의 이 배를 넘으면 부르지 않는다 (호출 아끼기)
const KS = [1, 2]; // 경유지 개수별 후보

// ── 인자 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const stage = args[0];
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const IDS = opt('--ids')?.split(',');
const TYPES = opt('--types')?.split(',');
const MAX_CALLS = Number(opt('--max-calls') ?? 150);

const pairs = [
  ...JSON.parse(readFileSync(join(ROOT, 'scripts/route-pairs.json'), 'utf8')),
  ...JSON.parse(readFileSync(join(ROOT, 'scripts/route-pairs-score.json'), 'utf8')),
].filter((p) => !IDS || IDS.includes(p.id));

// ── 작은 도구 ──────────────────────────────────────────
const round4 = (v) => Number(v.toFixed(4));
const rounded = (p) => ({ lat: round4(p.lat), lng: round4(p.lng) });
const rad = (d) => (d * Math.PI) / 180;
const meters = (a, b) => {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const r1 = (x) => Math.round(x * 10) / 10;
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => (a.length ? sorted(a)[Math.floor((a.length - 1) / 2)] : null);
const dirOf = (id) => join(OUT, id);
const fileOf = (id, tag) => join(dirOf(id), `walk-${tag}.json`);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const lineWkt = (paths) => `SRID=4326;MULTILINESTRING(${paths.map((p) => `(${p.map((q) => `${q.lng} ${q.lat}`).join(', ')})`).join(', ')})`;

// ── 카카오 ────────────────────────────────────────────
let calls = 0;
/** 카카오 도보 경로를 받아 저장한다. 이미 저장돼 있으면 부르지 않는다. via는 [{lat, lng}] */
async function fetchWalk(pair, tag, { mode, via = [] }) {
  const file = fileOf(pair.id, tag);
  if (existsSync(file)) return readJson(file);
  if (calls >= MAX_CALLS) throw new Error(`--max-calls ${MAX_CALLS}건을 다 썼다. 올려서 다시 실행하면 저장된 것은 건너뛴다`);
  const o = rounded(pair.origin.location);
  const d = rounded(pair.destination.location);
  const params = new URLSearchParams({
    start_x: String(o.lng),
    start_y: String(o.lat),
    end_x: String(d.lng),
    end_y: String(d.lat),
    route_mode: mode,
  });
  if (via.length) {
    // 형식은 probe로 확인한다: 여러 개면 쉼표로 이어 붙인다
    params.set('via_x', via.map((v) => round4(v.lng)).join(','));
    params.set('via_y', via.map((v) => round4(v.lat)).join(','));
  }
  calls++;
  const res = await fetch(`https://dapi.kakao.com/v2/routing/walk?${params}`, {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`카카오 HTTP ${res.status} (${pair.id} ${tag}): ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  mkdirSync(dirOf(pair.id), { recursive: true });
  writeFileSync(file, JSON.stringify(body));
  await new Promise((r) => setTimeout(r, 120));
  return body;
}

/** 저장된 응답 → { distanceM, path } (서버와 같은 변환) */
const loadWalk = (id, tag) => (existsSync(fileOf(id, tag)) ? toWalkRoute(readJson(fileOf(id, tag))) : null);

// ── 단계 ──────────────────────────────────────────────

async function baseline() {
  for (const pair of pairs) {
    for (const mode of ['SHORTEST', 'BROAD_FIRST']) await fetchWalk(pair, mode, { mode });
  }
  console.log(`기준 경로 저장 완료: ${pairs.length}쌍, 카카오 ${calls}건 (저장돼 있던 것은 건너뜀)`);
}

/** 경유지 후보를 DB에서 고른다. 쌍마다 { pairId, via: [{lat, lng, density}...] } */
async function pickCandidates(client, pair) {
  const shortest = loadWalk(pair.id, 'SHORTEST');
  const broad = loadWalk(pair.id, 'BROAD_FIRST');
  if (!shortest || !broad) throw new Error(`${pair.id}: 기준 경로가 없다 (baseline 먼저)`);
  const o = rounded(pair.origin.location);
  const d = rounded(pair.destination.location);
  const point = (p) => `SRID=4326;POINT(${p.lng} ${p.lat})`;
  const typeFilter = TYPES ? `AND f.type = ANY($7::text[])` : '';
  const densityTypeFilter = TYPES ? `AND f2.type = ANY($7::text[])` : '';
  const values = [lineWkt([shortest.path, broad.path]), CORRIDOR_M, point(o), END_MARGIN_M, point(d), DENSITY_M];
  values.push(...(TYPES ? [TYPES] : []));
  // $8 자리: 최단경로 선 (경로 위 제외용)
  const idx = values.length + 1;
  values.push(lineWkt([shortest.path]), OFF_ROUTE_M);
  const { rows } = await client.query(
    `SELECT f.id, ST_Y(f.location::geometry) AS lat, ST_X(f.location::geometry) AS lng,
        (SELECT sum(ft2.weight)::int FROM facilities f2 JOIN facility_types ft2 ON ft2.code = f2.type
          WHERE ST_DWithin(f2.location, f.location, $6::float8) ${densityTypeFilter}) AS density
     FROM facilities f
     WHERE ST_DWithin(f.location, ST_GeogFromText($1), $2::float8)
       AND NOT ST_DWithin(f.location, ST_GeogFromText($3), $4::float8)
       AND NOT ST_DWithin(f.location, ST_GeogFromText($5), $4::float8)
       AND NOT ST_DWithin(f.location, ST_GeogFromText($${idx}), $${idx + 1}::float8)
       ${typeFilter}
     ORDER BY density DESC NULLS LAST LIMIT 300`,
    values,
  );
  // 밀집도가 높은 순으로, 서로 떨어져 있고 너무 돌지 않는 지점을 고른다
  const chosen = [];
  for (const r of rows) {
    const p = { lat: r.lat, lng: r.lng, density: r.density };
    if (chosen.some((c) => meters(c, p) < SEPARATION_M)) continue;
    if (meters(o, p) + meters(p, d) > shortest.distanceM * MAX_VIA_DETOUR) continue;
    chosen.push(p);
    if (chosen.length === Math.max(...KS)) break;
  }
  // 경로 순서(출발에 가까운 순)로 늘어놓는다. 한 개 후보는 밀집도가 가장 높은 지점이다
  return { pairId: pair.id, best: chosen, candidates: rows.length };
}

async function candidates() {
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  const out = [];
  try {
    for (const pair of pairs) {
      const c = await pickCandidates(client, pair);
      const o = rounded(pair.origin.location);
      c.best.sort((a, b) => meters(o, a) - meters(o, b)); // 출발에서 가까운 순 (2개일 때 경유 순서)
      out.push(c);
      console.log(`${pair.id.padEnd(22)} 후보 ${String(c.candidates).padStart(3)}곳 → ${c.best.map((p) => `${r1(p.lat * 1)},${r1(p.lng * 1)} 밀집 ${p.density}`).join(' | ') || '없음'}`);
    }
  } finally {
    await client.end();
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `candidates${TYPES ? `-${TYPES.join('+')}` : ''}.json`), JSON.stringify(out, null, 1));
}

const candidateFile = () => join(OUT, `candidates${TYPES ? `-${TYPES.join('+')}` : ''}.json`);
const tagOf = (k) => `via${k}${TYPES ? `-${TYPES.join('+')}` : ''}`;

/** 후보에서 경유지 k개: 밀집도 상위 k개를 고르고 출발에서 가까운 순으로 늘어놓는다 */
const viaOf = (cand, pair, k) => {
  const o = rounded(pair.origin.location);
  const top = [...cand.best].sort((a, b) => b.density - a.density).slice(0, k);
  return top.sort((a, b) => meters(o, a) - meters(o, b));
};

async function probe() {
  const cands = readJson(candidateFile());
  const pair = pairs.find((p) => cands.some((c) => c.pairId === p.id && c.best.length >= 2));
  if (!pair) throw new Error('후보가 2개 이상인 쌍이 없다');
  const cand = cands.find((c) => c.pairId === pair.id);
  for (const k of [1, 2]) {
    const via = viaOf(cand, pair, k);
    const body = await fetchWalk(pair, `probe-via${k}`, { mode: 'SHORTEST', via });
    const walk = toWalkRoute(body);
    const base = loadWalk(pair.id, 'SHORTEST');
    const near = via.map((v) => Math.round(Math.min(...walk.path.map((p) => meters(p, v)))));
    console.log(`${pair.id} 경유지 ${k}개: status ${body.status}, ${base.distanceM}m → ${walk.distanceM}m, 경로가 경유지에 가장 가까워지는 거리(m) ${near.join(', ')}`);
  }
  console.log(`카카오 ${calls}건. 경유지 가까운 거리가 작으면(수십 m 이하) 파라미터가 먹은 것이다`);
}

async function route() {
  const cands = readJson(candidateFile());
  for (const pair of pairs) {
    const cand = cands.find((c) => c.pairId === pair.id);
    if (!cand?.best.length) continue;
    for (const k of KS) {
      if (cand.best.length < k) continue;
      await fetchWalk(pair, tagOf(k), { mode: 'SHORTEST', via: viaOf(cand, pair, k) });
    }
  }
  console.log(`경유지 경로 저장 완료, 카카오 ${calls}건 (저장돼 있던 것은 건너뜀)`);
}

async function report() {
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  /** 경로 하나의 { distanceM, safetyScore } — 서버와 같은 구간 나누기·SQL·점수 */
  const score = async (walk) => {
    const pieces = splitPath(walk.path);
    const q = segmentScoreQuery(pieces.map((p) => p.path));
    const raw = new Map((await client.query(q.text, q.values)).rows.map((r) => [r.i, r.raw]));
    const segs = pieces.map((p, i) => ({ distanceM: p.distanceM, safetyScore: toSegmentScore(raw.get(i) ?? 0) }));
    return { distanceM: walk.distanceM, safetyScore: toRouteScore(segs), zeroShare: segs.filter((s) => s.safetyScore === 0).reduce((n, s) => n + s.distanceM, 0) / segs.reduce((n, s) => n + s.distanceM, 0) };
  };
  const rows = [];
  try {
    for (const pair of pairs) {
      const S = loadWalk(pair.id, 'SHORTEST');
      const B = loadWalk(pair.id, 'BROAD_FIRST');
      if (!S || !B) continue;
      const s = await score(S);
      const b = await score(B);
      const vias = {};
      for (const k of KS) {
        const w = loadWalk(pair.id, tagOf(k));
        if (w) vias[k] = await score(w);
      }
      const base = pickSafe(s, [b]);
      const withA = pickSafe(s, [b, ...Object.values(vias)]);
      const pickedVia = Object.entries(vias).find(([, v]) => v === withA)?.[0] ?? null;
      rows.push({ id: pair.id, s, b, vias, baseChanged: base !== s, aChanged: withA !== s, pickedVia, gain: withA.safetyScore - s.safetyScore, detour: (100 * (withA.distanceM - s.distanceM)) / s.distanceM });
    }
  } finally {
    await client.end();
  }

  const fmt = (r) => (r ? `${r.safetyScore}점/${r.distanceM}m` : '-');
  console.log('쌍'.padEnd(22), '최단'.padEnd(12), '넓은길'.padEnd(12), '경유1'.padEnd(12), '경유2'.padEnd(12), '지금', '→ A보강');
  for (const r of rows) {
    console.log(
      r.id.padEnd(22), fmt(r.s).padEnd(12), fmt(r.b).padEnd(12), fmt(r.vias[1]).padEnd(12), fmt(r.vias[2]).padEnd(12),
      r.baseChanged ? '고름 ' : '같음 ', '→', r.aChanged ? `고름(${r.pickedVia ? `경유${r.pickedVia}` : '넓은길'}) +${r.gain}점 우회 ${r1(r.detour)}%` : '같음',
    );
  }
  const n = rows.length;
  const baseSame = rows.filter((r) => !r.baseChanged);
  const flipped = baseSame.filter((r) => r.aChanged);
  const viaPicked = rows.filter((r) => r.pickedVia);
  const withVia = rows.filter((r) => Object.keys(r.vias).length);
  console.log(`\n── 요약 (${n}쌍, 규칙 ${SAFE_MIN_GAIN}점 이상·우회 ${SAFE_MAX_DETOUR * 100}% 이하) ──`);
  console.log(`지금(B안): 다른 길을 고른 쌍 ${rows.filter((r) => r.baseChanged).length}/${n}`);
  console.log(`A 보강 후: 다른 길을 고른 쌍 ${rows.filter((r) => r.aChanged).length}/${n} (경유지 후보가 뽑힌 쌍 ${viaPicked.length}, 경유지 후보를 만든 쌍 ${withVia.length})`);
  console.log(`지금 "같음" ${baseSame.length}쌍 중 A 보강으로 다른 길이 된 쌍: ${flipped.length}`);
  console.log(`경유지가 뽑힌 쌍의 점수 차 중앙값 ${median(viaPicked.map((r) => r.gain))}점, 우회 중앙값 ${median(viaPicked.map((r) => r1(r.detour)))}%`);
  for (const k of KS) {
    const ok = rows.filter((r) => r.vias[k]);
    const gains = ok.map((r) => r.vias[k].safetyScore - r.s.safetyScore);
    const detours = ok.map((r) => (100 * (r.vias[k].distanceM - r.s.distanceM)) / r.s.distanceM);
    console.log(`경유지 ${k}개 후보: ${ok.length}쌍, 점수 차 중앙값 ${median(gains)}점(최대 ${Math.max(...gains)}) · 우회 중앙값 ${r1(median(detours))}%(최대 ${r1(Math.max(...detours))}) · 5점 이상 ${gains.filter((g) => g >= SAFE_MIN_GAIN).length}쌍 · 우회 20% 이하 ${detours.filter((x) => x <= SAFE_MAX_DETOUR * 100).length}쌍`);
  }
  writeFileSync(join(OUT, `report${TYPES ? `-${TYPES.join('+')}` : ''}.json`), JSON.stringify(rows, null, 1));
}

const stages = { baseline, candidates, probe, route, report };
if (!stages[stage]) {
  console.error(`단계를 고르세요: ${Object.keys(stages).join(' | ')}`);
  process.exit(1);
}
await stages[stage]();
