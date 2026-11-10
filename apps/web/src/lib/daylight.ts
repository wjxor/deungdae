const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// 일출 전이거나 일몰을 지나면 야간. 서버 /daylight의 isNight와 같은 식이다 (API.md 1-1장)
export function isNightAt(nowMs: number, sunrise: string, sunset: string): boolean {
  return nowMs < Date.parse(sunrise) || nowMs > Date.parse(sunset)
}

// 한국 날짜가 같은 날인지 비교하려고 날짜 번호로 바꾼다. 기기 시간대와 상관없다
function kstDay(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS)
}

// 받아 둔 일출·일몰이 오늘 것이 아니면 새로 받아야 한다
export function isStale(nowMs: number, sunset: string): boolean {
  return kstDay(Date.parse(sunset)) !== kstDay(nowMs)
}

// 다음에 낮/밤이 바뀔 수 있는 시각. 오늘 남은 일출·일몰 중 가까운 쪽이고, 없으면 한국 자정(새 일출·일몰을 받을 때)
export function nextCheckAt(nowMs: number, sunrise: string, sunset: string): number {
  const nextMidnight = (kstDay(nowMs) + 1) * DAY_MS - KST_OFFSET_MS
  const upcoming = [Date.parse(sunrise), Date.parse(sunset)].filter((t) => t > nowMs)
  return Math.min(...upcoming, nextMidnight)
}
