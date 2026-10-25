import type { SafetyLevel } from '../../../../shared/types.js';

// 안전점수·안심경로 값. 2026-10-25 귀갓길 60쌍 분석(docs/safety-score-experiment.md)으로 정한 MVP 임시값이고,
// 팀 회의에서 확정한다 (ROADMAP "팀 회의"). 바꾸면 그 문서의 스크립트를 다시 돌려 결과를 확인한다

/** 구간 원점수(반경 30m 안 시설의 가중치 합)가 이 값 이상이면 100점. 60쌍 최단경로 구간의 상위 5% 값 */
export const SCORE_CAP_RAW = 10;

/** 안심경로는 최단경로보다 이 점수 이상 높아야 고른다. S3 비교 문장("안전점수가 N점 높아요")도 그래서 늘 이 이상이다 */
export const SAFE_MIN_GAIN = 5;

/** 안심경로는 최단경로보다 이 비율 넘게 돌아가면 고르지 않는다 (0.2 = 20%, 카카오 거리 기준) */
export const SAFE_MAX_DETOUR = 0.2;

/**
 * 구간 원점수 → 0~100점 (로그). 시설이 없는 어두운 길에 하나 생기는 차이를,
 * 이미 밝은 길에 하나 더 생기는 차이보다 크게 본다. 원점수 1 → 29점, 5 → 75점, 10 이상 → 100점
 */
export function toSegmentScore(raw: number): number {
  if (raw <= 0) return 0;
  return Math.round(
    Math.min(100, (100 * Math.log1p(raw)) / Math.log1p(SCORE_CAP_RAW)),
  );
}

/** 경로 점수 = 구간 점수의 거리 가중 평균 (REQUIREMENTS 안전점수 규칙) */
export function toRouteScore(
  segments: readonly { distanceM: number; safetyScore: number }[],
): number {
  if (segments.length === 0) return 0;
  const totalM = segments.reduce((sum, s) => sum + s.distanceM, 0);
  if (totalM === 0) {
    // 거리가 0으로 반올림된 아주 짧은 경로는 단순 평균
    return Math.round(
      segments.reduce((sum, s) => sum + s.safetyScore, 0) / segments.length,
    );
  }
  return Math.round(
    segments.reduce((sum, s) => sum + s.safetyScore * s.distanceM, 0) / totalM,
  );
}

/** 구간 색상 기준 (REQUIREMENTS 안전점수 규칙: 70 이상 안전, 40~69 주의, 39 이하 위험) */
export function toSafetyLevel(score: number): SafetyLevel {
  if (score >= 70) return 'safe';
  if (score >= 40) return 'caution';
  return 'danger';
}

/** 점수를 매긴 후보 경로 */
export type ScoredCandidate = { distanceM: number; safetyScore: number };

/**
 * 안심경로로 쓸 후보를 고른다 (B안). 최단경로보다 `SAFE_MIN_GAIN`점 이상 높고 우회가 `SAFE_MAX_DETOUR` 이하인 후보 중
 * 점수가 가장 높은 것(같으면 짧은 것). 그런 후보가 없으면 최단경로 자체를 돌려준다 (→ `sameRoute: true`)
 */
export function pickSafe<T extends ScoredCandidate>(
  shortest: T,
  others: readonly T[],
): T {
  const maxDistanceM = shortest.distanceM * (1 + SAFE_MAX_DETOUR);
  let best = shortest;
  for (const c of others) {
    if (c.safetyScore - shortest.safetyScore < SAFE_MIN_GAIN) continue;
    if (c.distanceM > maxDistanceM) continue;
    const better =
      best === shortest ||
      c.safetyScore > best.safetyScore ||
      (c.safetyScore === best.safetyScore && c.distanceM < best.distanceM);
    if (better) best = c;
  }
  return best;
}
