import type { SafetyLevel } from '../../../../shared/types.js';

/** 구간 색상 기준 (REQUIREMENTS 안전점수 규칙: 70 이상 안전, 40~69 주의, 39 이하 위험) */
export function toSafetyLevel(score: number): SafetyLevel {
  if (score >= 70) return 'safe';
  if (score >= 40) return 'caution';
  return 'danger';
}
