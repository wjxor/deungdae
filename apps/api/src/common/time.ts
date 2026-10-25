const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 시각을 한국 시간 ISO 8601 문자열로 바꾼다 (API.md 공통 규칙: `2026-09-16T21:30:00+09:00`).
 * 서버가 어느 시간대에서 돌든 같은 값이 나오게 UTC에 9시간을 더해 만든다.
 */
export function toKstIso(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return `${kst.toISOString().slice(0, 19)}+09:00`;
}

/** 한국 시간 기준 날짜 (`2026-10-25`). 서버가 UTC로 돌아도 한국 자정에 날짜가 바뀐다 */
export function toKstDate(date: Date): string {
  return toKstIso(date).slice(0, 10);
}
