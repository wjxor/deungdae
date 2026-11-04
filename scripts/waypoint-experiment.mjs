/**
 * A 보강 경유지 실험 — "안심시설 밀집 지점" 방식 (docs/waypoint-experiment.md)
 *
 * 최단경로는 카카오 최단 그대로 보여 주고, 안심경로 후보에 경유지를 넣은 길을 더해
 * 지금 규칙(B안: 최단보다 5점 이상 높고 우회 20% 이하)으로 안심경로가 어떻게 달라지는지 본다.
 *
 * 안심경로 후보 (최단과 비교해 고른다)
 *   B        : 넓은 길 우선 (지금)
 *   S+경유   : 최단 경로 모드 + 경유지 여러 개 (경유지는 최단경로에서 벗어난 시설 밀집 지점)
 *   B+경유   : 넓은 길 우선 모드 + 경유지 여러 개 (경유지는 넓은 길 경로에서 벗어난 시설 밀집 지점)
 *
 * 경유지 고르기: 경로 근처에서 밀집도가 높은 지점부터 최대 --max-via개. 서로 --min-gap m 이상 떨어뜨리고,
 *   밀집도가 --min-density 미만이면 쓰지 않으며, 경로를 따라 출발에 가까운 순으로 카카오에 넘긴다.
 *   밀집도 = 서버 점수와 같은 방식(반경 30m 안 시설 가중치 합, 같은 좌표의 CCTV·안심벨은 한 곳, 원점수 상한 SCORE_CAP_RAW)
 *
 * 경유지를 언제 쓰나 (--when)
 *   same(기본): 최단과 넓은 길 우선이 같은 길일 때만 (겹침 OVERLAP_SAME 이상). 이때만 S+경유 한 건을 더 부른다 — 같은 길이라 B+경유는 같다
 *   all       : 늘 S+경유·B+경유 둘 다 (앞선 6쌍 실험처럼)
 *
 * 실행 (레포 루트에서):
 *   (cd apps/api && npm run build)                        # 서버 코드를 그대로 쓰려고 dist를 import한다
 *   node --env-file=.env scripts/waypoint-experiment.mjs baseline    # 최단·넓은 길 우선을 카카오에서 받아 저장 (쌍마다 2건)
 *   node --env-file=.env scripts/waypoint-experiment.mjs candidates  # 경유지 후보를 DB에서 고른다 (카카오 안 부름)
 *   node --env-file=.env scripts/waypoint-experiment.mjs route       # 경유지를 넣은 경로를 받아 저장 (쌍마다 2건)
 *   node --env-file=.env scripts/waypoint-experiment.mjs report      # 점수를 매기고 지금 결과와 비교 (카카오 안 부름)
 *
 * 옵션
 *   --pairs a.json,b.json   쌍 파일 (기본: scripts/route-pairs.json, scripts/route-pairs-score.json — 안전점수 실험과 같다)
 *   --ids a,b,c      이 쌍만 (처음에는 몇 쌍으로 시험해 보는 용도)
 *   --types cctv,emergency_bell,police   밀집 지점을 셀 시설 종류 (기본: 5종 전부). 안심시설만 세는 변형을 보려는 것
 *   --when same|all  경유지 후보를 만드는 조건 (위 설명)
 *   --corridor M     기준 경로에서 이 거리(m) 안의 시설만 경유지 후보로 본다 (기본 250)
 *   --max-retrace M  경유지 경로가 왔던 길을 되돌아가는 길이가 이 m 이상이면 후보에서 뺀다 (report 단계, 기본 없음)
 *   --max-via N      경유지 최대 개수 (기본 3. 카카오 한도는 5)
 *   --min-gap M      경유지끼리 최소 거리 m (기본 300)
 *   --min-density N  이 밀집도(원점수) 미만인 지점은 경유지로 쓰지 않는다 (기본 5)
 *   --max-calls N    이 실행에서 카카오를 부를 최대 건수 (기본 150). 하루 한도는 앱 하나에 1,000건
 *
 * - 쌍 파일 형식: [{ id, origin: { location: { lat, lng } }, destination: { location: { lat, lng } } }]
 * - 카카오 좌표는 서버처럼 소수 4자리로 반올림해 부른다. 응답은 scripts/output/waypoint/ 에 저장해 다시 부르지 않는다 (gitignore)
 * - 점수·구간 나누기·고르는 규칙은 서버(apps/api/src/routes) 함수를 그대로 쓴다. 시설은 DB facilities 테이블(읽기만)
 * - 필요: .env의 KAKAO_REST_API_KEY, DIRECT_URL
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const { segmentScoreQuery, FACILITY_RADIUS_M } = await load('routes/safety-score.query.js');
const { toSegmentScore, toRouteScore, pickSafe, SAFE_MIN_GAIN, SAFE_MAX_DETOUR, SCORE_CAP_RAW } = await load('routes/safety.js');

// ── 실험 값 (이 값을 바꿔 가며 본다) ───────────────────────
const DEFAULT_CORRIDOR_M = 250; // 최단·넓은 길 우선 경로에서 이 안의 시설을 경유지 후보로 본다
const OFF_ROUTE_M = 60; // 기준 경로 위(이 안)의 지점은 길을 바꾸지 못하므로 뺀다
const DENSITY_M = FACILITY_RADIUS_M; // 밀집도 = 후보 지점 반경 이 안 시설의 가중치 합 (서버 점수와 같은 30m)
const END_MARGIN_M = 150; // 출발·도착에서 이만큼은 떨어진 지점만 (끝에서 되돌아오는 경유지 방지)
const MAX_VIA_DETOUR = 1 + SAFE_MAX_DETOUR; // 출발→경유지들→도착 직선 합이 최단 거리의 이 배를 넘으면 쓰지 않는다. 직선은 실제 길보다 짧아서 넘으면 우회 20%도 반드시 넘는다 (호출 아끼기)
// 경유지 후보는 기준 모드마다 따로 고른다 (기준 경로에서 벗어난 지점이어야 길이 바뀐다)
const OVERLAP_TOLERANCE_M = 20; // 두 경로가 이 안이면 같은 길로 센다 (docs/route-mode-experiment.md와 같은 기준)
const OVERLAP_SAME = 0.98; // 겹침이 이 이상이면 같은 길 (docs/safety-score-experiment.md 7번)
const BASES = [
  { key: 'S', mode: 'SHORTEST', label: 'S+경유' },
  { key: 'B', mode: 'BROAD_FIRST', label: 'B+경유' },
];

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
const WHEN = opt('--when') ?? 'same';
const CORRIDOR_M = Number(opt('--corridor') ?? DEFAULT_CORRIDOR_M);
const MAX_VIA = Number(opt('--max-via') ?? 3);
const MAX_RETRACE_M = opt('--max-retrace') === undefined ? Infinity : Number(opt('--max-retrace'));
const MIN_GAP_M = Number(opt('--min-gap') ?? 300);
const MIN_DENSITY = Number(opt('--min-density') ?? 5);
if (!['same', 'all'].includes(WHEN)) throw new Error('--when은 same 또는 all');
const PAIR_FILES = opt('--pairs')?.split(',') ?? ['scripts/route-pairs.json', 'scripts/route-pairs-score.json'];
// 설정이 기본값과 다르면 후보·보고서 파일 이름에 붙여서, 다른 설정의 결과를 덮어쓰지 않게 한다
const SUFFIX = `${WHEN === 'all' ? '-all' : ''}${TYPES ? `-${TYPES.join('+')}` : ''}${CORRIDOR_M !== DEFAULT_CORRIDOR_M ? `-c${CORRIDOR_M}` : ''}${MAX_VIA !== 3 ? `-n${MAX_VIA}` : ''}${MIN_GAP_M !== 300 ? `-gap${MIN_GAP_M}` : ''}${MIN_DENSITY !== 5 ? `-d${MIN_DENSITY}` : ''}`;
// 되돌아감 기준은 후보를 바꾸지 않고 report에서만 쓰므로, 후보 파일 이름이 아니라 보고서 이름에만 붙인다
const REPORT_SUFFIX = `${SUFFIX}${MAX_RETRACE_M !== Infinity ? `-r${MAX_RETRACE_M}` : ''}`;

const pairs = PAIR_FILES.flatMap((f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'))).filter((p) => !IDS || IDS.includes(p.id));

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
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fileOf = (id, tag) => join(OUT, id, `walk-${tag}.json`);
const candidateFile = () => join(OUT, `candidates${SUFFIX}.json`);
// 경유지 좌표로 이름을 정해서, 설정을 바꿔 경유지가 달라지면 이전 응답을 잘못 쓰지 않는다
const viaTag = (base, vias) => `via${base.key}-${createHash('sha1').update(vias.map((v) => `${round4(v.lat)},${round4(v.lng)}`).join(';')).digest('hex').slice(0, 10)}`;
const lineWkt = (paths) => `SRID=4326;MULTILINESTRING(${paths.map((p) => `(${p.map((q) => `${q.lng} ${q.lat}`).join(', ')})`).join(', ')})`;
const pointWkt = (p) => `SRID=4326;POINT(${p.lng} ${p.lat})`;

/**
 * 경로가 왔던 길을 되돌아가는 길이(m)의 근사. 10m 간격으로 찍은 점 중, 30m 넘게 앞서 지나간 자리의 12m 안으로 다시 온 점의 수 x 10.
 * 경유지가 골목·막다른 길에 있으면 카카오가 들어갔다 같은 길로 나오는 경로를 만든다
 */
function retraceM(path) {
  const pts = [];
  let acc = 0, next = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = meters(path[i - 1], path[i]);
    while (next <= acc + seg && seg > 0) {
      const t = (next - acc) / seg;
      pts.push({ lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t, lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t, d: next });
      next += 10;
    }
    acc += seg;
  }
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pts[i].d - pts[j].d > 30 && meters(pts[i], pts[j]) <= 12) { n++; break; }
    }
  }
  return n * 10;
}

/** a 경로 위 점(5m 간격) 중 b 경로에서 OVERLAP_TOLERANCE_M 안인 비율 */
function coverage(a, b) {
  const kx = 111320 * Math.cos(rad(a[0].lat)); // 경도 1도 ≈ m
  const ky = 110574; // 위도 1도 ≈ m
  const xy = (p) => [p.lng * kx, p.lat * ky];
  const B = b.map(xy);
  const dist = (pt) => {
    let best = Infinity;
    for (let i = 0; i + 1 < B.length; i++) {
      const [x1, y1] = B[i];
      const [x2, y2] = B[i + 1];
      const dx = x2 - x1, dy = y2 - y1;
      const t = dx || dy ? Math.max(0, Math.min(1, ((pt[0] - x1) * dx + (pt[1] - y1) * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, Math.hypot(pt[0] - (x1 + t * dx), pt[1] - (y1 + t * dy)));
    }
    return best;
  };
  let near = 0, total = 0;
  for (let i = 0; i + 1 < a.length; i++) {
    const [x1, y1] = xy(a[i]);
    const [x2, y2] = xy(a[i + 1]);
    const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 5));
    for (let k = 0; k < steps; k++) {
      total++;
      if (dist([x1 + ((x2 - x1) * k) / steps, y1 + ((y2 - y1) * k) / steps]) <= OVERLAP_TOLERANCE_M) near++;
    }
  }
  return total ? near / total : 1;
}
/** 최단과 넓은 길 우선의 겹침 (양방향 중 작은 값) */
const overlapOf = (s, b) => Math.min(coverage(s.path, b.path), coverage(b.path, s.path));
/** 이 쌍에서 경유지 후보를 만들 기준 모드들 */
const basesFor = (overlap) => (WHEN === 'all' ? BASES : overlap >= OVERLAP_SAME ? [BASES[0]] : []);

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
    // 경유지 여러 개는 쉼표로 잇는다 (2026-10-31 확인: 경유지 1~2개 모두 경로가 4~11m 안을 지났다)
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
  mkdirSync(join(OUT, pair.id), { recursive: true });
  writeFileSync(file, JSON.stringify(body));
  await new Promise((r) => setTimeout(r, 120));
  return body;
}

/** 저장된 응답 → { distanceM, path } (서버와 같은 변환). 없으면 null */
const loadWalk = (id, tag) => (existsSync(fileOf(id, tag)) ? toWalkRoute(readJson(fileOf(id, tag))) : null);

// ── 단계 ──────────────────────────────────────────────

async function baseline() {
  for (const pair of pairs) {
    for (const mode of ['SHORTEST', 'BROAD_FIRST']) await fetchWalk(pair, mode, { mode });
  }
  console.log(`기준 경로 저장 완료: ${pairs.length}쌍, 카카오 ${calls}건 (저장돼 있던 것은 건너뜀)`);
}

/** 기준 경로를 따라 간 거리(m): 점에서 가장 가까운 경로 꼭짓점까지 누적 거리 */
function alongRoute(path, pt) {
  let best = Infinity, at = 0, acc = 0;
  for (let i = 0; i < path.length; i++) {
    if (i) acc += meters(path[i - 1], path[i]);
    const dist = meters(path[i], pt);
    if (dist < best) { best = dist; at = acc; }
  }
  return at;
}
/** 출발 → 경유지들 → 도착 직선 거리 합 */
function straightLen(o, vias, d) {
  let total = 0, prev = o;
  for (const v of vias) { total += meters(prev, v); prev = v; }
  return total + meters(prev, d);
}

/**
 * 기준 경로(base) 근처에서 시설이 몰린 지점을 밀집도 순으로 최대 MAX_VIA개 고른다.
 * 후보 = 최단·넓은 길 우선 경로 CORRIDOR_M 안의 시설 중, 기준 경로 위가 아니고 출발·도착에서 떨어진 것.
 * 이미 고른 지점과 MIN_GAP_M 안이거나, 밀집도가 MIN_DENSITY 미만이거나, 출발→경유지들→도착이 너무 돌면 건너뛴다.
 * 밀집도: 서버 점수와 같게 반경 30m 안 가중치 합 (같은 좌표의 CCTV·안심벨은 한 곳), 원점수 상한까지만 센다.
 * 밀집도가 같으면 기준 경로에 가까운 지점이 먼저다. 고른 지점은 경로를 따라 출발에 가까운 순으로 돌려준다
 */
async function pickVias(client, pair, base, shortest, broad) {
  const baseWalk = base.key === 'S' ? shortest : broad;
  const o = rounded(pair.origin.location);
  const d = rounded(pair.destination.location);
  const values = [lineWkt([shortest.path, broad.path]), CORRIDOR_M, pointWkt(o), END_MARGIN_M, pointWkt(d), DENSITY_M, lineWkt([baseWalk.path]), OFF_ROUTE_M, SCORE_CAP_RAW];
  if (TYPES) values.push(TYPES);
  const typeFilter = TYPES ? 'AND f.type = ANY($10::text[])' : '';
  const densityTypeFilter = TYPES ? 'AND f2.type = ANY($10::text[])' : '';
  const { rows } = await client.query(
    `SELECT f.id, ST_Y(f.location::geometry) AS lat, ST_X(f.location::geometry) AS lng,
        LEAST((SELECT coalesce(sum(t.w), 0) FROM (
          SELECT DISTINCT ON (CASE WHEN f2.type IN ('cctv', 'emergency_bell') THEN f2.type || f2.location::text ELSE f2.id::text END) ft2.weight AS w
          FROM facilities f2 JOIN facility_types ft2 ON ft2.code = f2.type
          WHERE ST_DWithin(f2.location, f.location, $6::float8) ${densityTypeFilter}) t), $9::int)::int AS density,
        ST_Distance(f.location, ST_GeogFromText($7))::float8 AS off_m
     FROM facilities f
     WHERE ST_DWithin(f.location, ST_GeogFromText($1), $2::float8)
       AND NOT ST_DWithin(f.location, ST_GeogFromText($3), $4::float8)
       AND NOT ST_DWithin(f.location, ST_GeogFromText($5), $4::float8)
       AND NOT ST_DWithin(f.location, ST_GeogFromText($7), $8::float8)
       ${typeFilter}
     ORDER BY density DESC, off_m ASC LIMIT 300`,
    values,
  );
  const chosen = [];
  for (const r of rows) {
    if (chosen.length >= MAX_VIA || r.density < MIN_DENSITY) break; // 밀집도 순이라 여기서 끝
    if (chosen.some((c) => meters(c, r) < MIN_GAP_M)) continue;
    r.along = alongRoute(baseWalk.path, r);
    const next = [...chosen, r].sort((x, y) => x.along - y.along);
    if (straightLen(o, next, d) > shortest.distanceM * MAX_VIA_DETOUR) continue;
    chosen.push(r);
  }
  chosen.sort((x, y) => x.along - y.along);
  return { vias: chosen.map((r) => ({ lat: r.lat, lng: r.lng, density: r.density })), candidates: rows.length };
}

async function candidates() {
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  const out = [];
  try {
    for (const pair of pairs) {
      const shortest = loadWalk(pair.id, 'SHORTEST');
      const broad = loadWalk(pair.id, 'BROAD_FIRST');
      if (!shortest || !broad) throw new Error(`${pair.id}: 기준 경로가 없다 (baseline 먼저)`);
      const overlap = overlapOf(shortest, broad);
      const entry = { pairId: pair.id, overlap: r1(overlap * 100) };
      const bases = basesFor(overlap);
      for (const base of bases) entry[base.key] = await pickVias(client, pair, base, shortest, broad);
      out.push(entry);
      const show = (b) => (entry[b.key].vias.length ? `${entry[b.key].vias.length}개 ` + entry[b.key].vias.map((v) => `${v.lat.toFixed(4)},${v.lng.toFixed(4)}(밀집 ${v.density})`).join(' → ') : '없음');
      console.log(`${pair.id.padEnd(22)} 최단·큰길 겹침 ${String(entry.overlap).padStart(5)}% ${bases.length ? bases.map((b) => `${b.label} ${show(b)}`).join(' | ') : '→ 다른 길이라 경유지 안 씀'}`);
    }
  } finally {
    await client.end();
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(candidateFile(), JSON.stringify(out, null, 1));
  const withBase = out.flatMap((e) => BASES.map((b) => e[b.key]).filter(Boolean));
  const countOf = (n) => withBase.filter((c) => c.vias.length === n).length;
  console.log(`
경유지 후보를 만든 쌍 ${withBase.length}쌍 — ${Array.from({ length: MAX_VIA + 1 }, (_, n) => `경유지 ${n}개 ${countOf(n)}쌍`).join(', ')} (최대 ${MAX_VIA}개, 서로 ${MIN_GAP_M}m 이상, 밀집 ${MIN_DENSITY} 이상)`);
}

async function route() {
  const cands = readJson(candidateFile());
  for (const pair of pairs) {
    const cand = cands.find((c) => c.pairId === pair.id);
    for (const base of BASES) {
      const vias = cand?.[base.key]?.vias ?? [];
      if (vias.length) await fetchWalk(pair, viaTag(base, vias), { mode: base.mode, via: vias });
    }
  }
  console.log(`경유지 경로 저장 완료, 카카오 ${calls}건 (저장돼 있던 것은 건너뜀)`);
}

async function report() {
  const cands = readJson(candidateFile());
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  /** 경로 하나의 { distanceM, safetyScore } — 서버와 같은 구간 나누기·SQL·점수 */
  const score = async (walk) => {
    const pieces = splitPath(walk.path);
    const q = segmentScoreQuery(pieces.map((p) => p.path));
    const raw = new Map((await client.query(q.text, q.values)).rows.map((r) => [r.i, r.raw]));
    const segs = pieces.map((p, i) => ({ distanceM: p.distanceM, safetyScore: toSegmentScore(raw.get(i) ?? 0) }));
    return { distanceM: walk.distanceM, safetyScore: toRouteScore(segs) };
  };
  const rows = [];
  try {
    for (const pair of pairs) {
      const S = loadWalk(pair.id, 'SHORTEST');
      const B = loadWalk(pair.id, 'BROAD_FIRST');
      if (!S || !B) continue;
      const s = await score(S);
      const b = { ...(await score(B)), label: '큰길' };
      const overlap = overlapOf(S, B);
      const vias = [];
      // --when 규칙에 맞는 경유지 응답만 쓴다 (다른 규칙으로 받아 둔 파일이 섞이지 않게)
      for (const base of basesFor(overlap)) {
        const picked = cands.find((c) => c.pairId === pair.id)?.[base.key]?.vias ?? [];
        const w = picked.length ? loadWalk(pair.id, viaTag(base, picked)) : null;
        if (w) {
          const retrace = retraceM(w.path);
          if (retrace >= MAX_RETRACE_M) continue; // 되돌아가는 길이 너무 긴 경유지 경로는 후보에서 뺀다
          vias.push({ ...(await score(w)), label: base.label, viaCount: picked.length, retrace });
        }
      }
      const now = pickSafe(s, [b]); // 지금 서버 (B안)
      const next = pickSafe(s, [b, ...vias]); // 경유지 후보를 더한 결과
      rows.push({ id: pair.id, overlap, sameWay: overlap >= OVERLAP_SAME, s, b, vias, nowChanged: now !== s, nextChanged: next !== s, picked: next === s ? null : next.label, gain: next.safetyScore - s.safetyScore, detour: (100 * (next.distanceM - s.distanceM)) / s.distanceM });
    }
  } finally {
    await client.end();
  }

  const fmt = (r) => (r ? `${r.safetyScore}점/${r.distanceM}m` : '-');
  const viaOf = (r, label) => r.vias.find((v) => v.label === label);
  console.log('쌍'.padEnd(22), '최단'.padEnd(12), '큰길'.padEnd(12), 'S+경유'.padEnd(12), 'B+경유'.padEnd(12), '지금 → 경유지 후보 더하면');
  for (const r of rows) {
    console.log(
      r.id.padEnd(22), fmt(r.s).padEnd(12), fmt(r.b).padEnd(12), fmt(viaOf(r, 'S+경유')).padEnd(12), fmt(viaOf(r, 'B+경유')).padEnd(12),
      r.nowChanged ? '고름' : '같음', '→', r.nextChanged ? `고름(${r.picked}) +${r.gain}점 우회 ${r1(r.detour)}%` : '같음',
    );
  }
  const n = rows.length;
  const nowSame = rows.filter((r) => !r.nowChanged);
  const flipped = nowSame.filter((r) => r.nextChanged);
  const viaPicked = rows.filter((r) => r.picked && r.picked !== '큰길');
  const better = rows.filter((r) => r.nowChanged && r.nextChanged && r.picked !== '큰길');
  console.log(`\n── 요약 (${n}쌍, 규칙 ${SAFE_MIN_GAIN}점 이상·우회 ${SAFE_MAX_DETOUR * 100}% 이하) ──`);
  const sameWay = rows.filter((r) => r.sameWay);
  console.log(`최단과 큰길이 같은 길(겹침 ${OVERLAP_SAME * 100}% 이상): ${sameWay.length}/${n}쌍 — 경유지 후보를 만든 쌍 ${sameWay.filter((r) => r.vias.length).length}, 그중 다른 길이 된 쌍 ${sameWay.filter((r) => r.nextChanged).length}`);
  console.log(`지금(큰길만): 다른 길을 고른 쌍 ${rows.filter((r) => r.nowChanged).length}/${n}`);
  console.log(`경유지 후보를 더하면: ${rows.filter((r) => r.nextChanged).length}/${n} (경유지 후보가 뽑힌 쌍 ${viaPicked.length})`);
  console.log(`지금 "같음" ${nowSame.length}쌍 중 다른 길이 된 쌍: ${flipped.length}`);
  console.log(`지금도 다른 길인데 경유지 후보가 더 높아 바뀐 쌍: ${better.length}`);
  console.log(`경유지가 뽑힌 쌍의 점수 차 중앙값 ${median(viaPicked.map((r) => r.gain))}점, 우회 중앙값 ${median(viaPicked.map((r) => r1(r.detour)))}%`);
  for (const label of ['S+경유', 'B+경유']) {
    const ok = rows.filter((r) => viaOf(r, label));
    if (!ok.length) continue;
    console.log(`${label} 경유지 개수: ${[1, 2, 3, 4, 5].map((n) => [n, ok.filter((r) => viaOf(r, label).viaCount === n).length]).filter(([, c]) => c).map(([n, c]) => `${n}개 ${c}쌍`).join(', ')}`);
    const gains = ok.map((r) => viaOf(r, label).safetyScore - r.s.safetyScore);
    const detours = ok.map((r) => (100 * (viaOf(r, label).distanceM - r.s.distanceM)) / r.s.distanceM);
    console.log(`${label}: ${ok.length}쌍, 점수 차 중앙값 ${median(gains)}점(최대 ${Math.max(...gains)}) · 우회 중앙값 ${r1(median(detours))}%(최대 ${r1(Math.max(...detours))}) · 5점 이상 ${gains.filter((g) => g >= SAFE_MIN_GAIN).length}쌍 · 우회 20% 이하 ${detours.filter((x) => x <= SAFE_MAX_DETOUR * 100).length}쌍`);
  }
  writeFileSync(join(OUT, `report${REPORT_SUFFIX}.json`), JSON.stringify(rows, null, 1));
}

const stages = { baseline, candidates, route, report };
if (!stages[stage]) {
  console.error(`단계를 고르세요: ${Object.keys(stages).join(' | ')}`);
  process.exit(1);
}
await stages[stage]();
